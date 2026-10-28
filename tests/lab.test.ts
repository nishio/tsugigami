// lab が repo と話す部分: 待ち行列の一覧、スクリプトの読み出し、結果(文字とバイナリ)の commit と待ち行列からの削除
import { describe, expect, it } from 'vitest';
import { LabRepo, QUEUE, RESULTS } from '../src/lab/repo';
import { FakeGitHub } from './fakeGitHub';

describe('LabRepo', () => {
  it('待ち行列を名前順に見て、結果を 1 つの commit にし、待ち行列から消す', async () => {
    const gh = new FakeGitHub();
    await gh.pushFromElsewhere('README.md', '# notes\n');
    await gh.pushFromElsewhere(`${QUEUE}002-b.js`, 'lab.log("b")');
    await gh.pushFromElsewhere(`${QUEUE}001-a.js`, 'lab.log("a")');
    const repo = new LabRepo({ repo: gh.repo, token: gh.token }, gh.fetch);
    const q = await repo.queue();
    expect(q.map(e => e.id)).toEqual(['001-a', '002-b']);
    expect(await repo.read(q[0].path)).toBe('lab.log("a")');

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
    const dir = `${RESULTS}001-a/`;
    const sha = await repo.commit(new Map([[dir + 'status.json', { text: '{"ok":true}\n' }], [dir + 'shot.png', { bytes: png }]]), [q[0].path], 'lab: 001-a ok');
    expect(gh.ref).toBe(sha);
    expect(gh.files().get(dir + 'status.json')).toBe('{"ok":true}\n');
    expect(gh.binaries().get(dir + 'shot.png')).toEqual(png);
    expect(gh.files().has(`${QUEUE}001-a.js`)).toBe(false);
    expect((await repo.queue()).map(e => e.id)).toEqual(['002-b']);
  });

  it('待ち行列のフォルダが無ければ空', async () => {
    const gh = new FakeGitHub();
    await gh.pushFromElsewhere('README.md', '# notes\n');
    const repo = new LabRepo({ repo: gh.repo, token: gh.token }, gh.fetch);
    expect(await repo.queue()).toEqual([]);
  });

  it('先頭が進んでいたらやり直して、それでも乗せる', async () => {
    const gh = new FakeGitHub();
    await gh.pushFromElsewhere('README.md', '# notes\n');
    const repo = new LabRepo({ repo: gh.repo, token: gh.token }, gh.fetch);
    let bumped = false;
    const fetchRace = async (url: string, init?: RequestInit) => {
      if (!bumped && init?.method === 'POST' && url.endsWith('/git/commits')) { bumped = true; await gh.pushFromElsewhere('other.txt', 'x'); }
      return gh.fetch(url, init);
    };
    const r2 = new LabRepo({ repo: gh.repo, token: gh.token }, fetchRace);
    await r2.commit(new Map([['a.txt', { text: 'a' }]]), [], 'm');
    expect(gh.files().get('a.txt')).toBe('a');
    expect(gh.files().get('other.txt')).toBe('x');
    void repo;
  });
});
