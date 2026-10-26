import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { bboxOf } from '../src/geom';
import { GitHubBackup, GitHubError, gitBlobSha, notePath, pagePath } from '../src/github';
import { PAGE_GAP, PAGE_H, type Stroke, newNote } from '../src/model';
import { Store } from '../src/store';
import { FakeGitHub } from './fakeGitHub';

let seq = 0;
const mk = (noteId: string, y: number, id = 's' + ++seq): Stroke => {
  const pts = Float32Array.from([10.123, y, 0.5, 60.456, y + 5, 0.7]);
  return { id, noteId, kind: 'pen', color: '#000000', width: 2.2, pts, b: bboxOf(pts, 3, 1.1), z: seq };
};
const page2 = PAGE_H + PAGE_GAP + 100;

async function setup(name: string) {
  const store = await Store.open(name), gh = new FakeGitHub();
  const n = newNote(1);
  await store.putNote(n);
  await store.saveStrokes([mk(n.id, 100), mk(n.id, 200)], []);
  return { store, gh, n, bk: new GitHubBackup({ repo: gh.repo, token: gh.token }, gh.fetch) };
}

describe('GitHub へのバックアップ', () => {
  it('blob の sha は git と同じ', async () => {
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('空の repo に最初の commit を作り、ノートとページのファイルを置く', async () => {
    const { gh, n, bk } = await setup('g1');
    const r = await bk.backup(await Store.open('g1'));
    expect(r.commit).not.toBeNull();
    const files = gh.files();
    expect(files.has('README.md')).toBe(true);
    expect(JSON.parse(files.get(notePath(n.id))!).note.id).toBe(n.id);
    const page = JSON.parse(files.get(pagePath(n.id, 0))!);
    expect(page.strokes).toHaveLength(2);
    expect(page.strokes[0].pts[0]).toBe(10.12);
  });

  it('変わっていなければ commit しない。変わったページだけ送る', async () => {
    const { store, gh, n, bk } = await setup('g2');
    const r1 = await bk.backup(store);
    gh.calls = [];
    const r2 = await bk.backup(store, r1.state);
    expect(r2.commit).toBeNull();
    // 読むだけで、書き込みの API は呼ばない。変わっていないノートのストロークも読まない
    expect(gh.calls.filter(c => !c.startsWith('GET'))).toEqual([]);
    expect(r2.state[n.id]).toBe(r1.state[n.id]);
  });

  it('2 ページ目に書いたら、1 ページ目は送らない。ページが空になったらファイルを消す', async () => {
    const { store, gh, n, bk } = await setup('g3');
    const r1 = await bk.backup(store);
    n.updated = 2; n.pages.push({ w: 1 });
    await store.putNote(n);
    const s = mk(n.id, page2);
    await store.saveStrokes([s], []);
    gh.calls = [];
    const r2 = await bk.backup(store, r1.state);
    expect(r2.commit).not.toBeNull();
    const sent = gh.calls.filter(c => c === 'POST /git/blobs').length;
    expect(sent).toBe(3); // README・note.json・p0002(p0001 は同じなので送らない)
    expect(gh.files().has(pagePath(n.id, 1))).toBe(true);

    await store.saveStrokes([], [s.id]);
    n.updated = 3; await store.putNote(n);
    await bk.backup(store, r2.state);
    expect(gh.files().has(pagePath(n.id, 1))).toBe(false);
    expect(gh.files().has(pagePath(n.id, 0))).toBe(true);
  });

  it('手元に無いノートは消さない。完全に削除したと記録したノートだけ消す', async () => {
    const { store, gh, n, bk } = await setup('g4');
    await bk.backup(store);
    // 手元が空になった(別の端末、入れ直したなど)
    const empty = await Store.open('g4-empty');
    await bk.backup(empty);
    expect(gh.files().has(notePath(n.id))).toBe(true);
    // 完全に削除した
    await bk.backup(empty, {}, [n.id]);
    expect(gh.files().has(notePath(n.id))).toBe(false);
    expect(gh.files().has(pagePath(n.id, 0))).toBe(false);
  });

  it('別の端末が先に書き込んでいても、やり直して両方を残す', async () => {
    const { store, gh, n, bk } = await setup('g5');
    await bk.backup(store);
    // backup が先頭を読んだ後、書き込む前に別の端末が進める
    const orig = gh.fetch;
    let once = false;
    gh.fetch = async (url, init) => {
      if (!once && init?.method === 'PATCH') { once = true; await gh.pushFromElsewhere('notes/other/note.json', '{}'); }
      return orig(url, init);
    };
    const bk2 = new GitHubBackup({ repo: gh.repo, token: gh.token }, (u, i) => gh.fetch(u, i));
    n.updated = 5; n.title = '改名'; await store.putNote(n);
    const r = await bk2.backup(store);
    expect(r.commit).not.toBeNull();
    expect(gh.files().has('notes/other/note.json')).toBe(true);
    expect(JSON.parse(gh.files().get(notePath(n.id))!).note.title).toBe('改名');
  });

  it('repo から別の端末へ戻せる', async () => {
    const { store, n, bk } = await setup('g6');
    await bk.backup(store);
    const fresh = await Store.open('g6-fresh');
    expect(await fresh.importAll(await bk.restore())).toBe(1);
    const a = (await store.strokesOf(n.id)).sort((x, y) => x.z - y.z), b = (await fresh.strokesOf(n.id)).sort((x, y) => x.z - y.z);
    expect(b.map(s => s.id)).toEqual(a.map(s => s.id));
    b.forEach((s, i) => s.pts.forEach((v, j) => expect(Math.abs(v - a[i].pts[j])).toBeLessThan(0.006)));
    expect(b[0].pts).toBeInstanceOf(Float32Array);
    expect((await fresh.getNote(n.id))!.title).toBe(n.title);
  });

  it('トークンが違えば分かる言葉で失敗する', async () => {
    const { store, gh } = await setup('g7');
    const bad = new GitHubBackup({ repo: gh.repo, token: 'wrong' }, gh.fetch);
    await expect(bad.backup(store)).rejects.toThrow(GitHubError);
    await expect(bad.backup(store)).rejects.toThrow(/トークン/);
  });
});
