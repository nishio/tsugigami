// GitHub の repo へノートを逃がす(自動バックアップ)。サーバーは使わず、ブラウザから GitHub の API を直接呼ぶ。
//
// repo の中の形:
//   README.md                 ノートの一覧(人が GitHub 上で眺める用)
//   notes/<noteId>/note.json  ノートの設定(題名・ページ・方眼など)
//   notes/<noteId>/p0001.json ページごとのストローク(上端がそのページにある線)。1 行に 1 本
//
// 1 回のバックアップは 1 つの commit になる。履歴が残るので、どの時点の状態にも戻せる。
// 手元に無いノートのファイルは消さない(別の端末や、手元が空になったときに、上書きで消さないため)。
// 消すのは「手元で完全に削除した」と記録したノートと、手元にあるノートの空になったページだけ。
import { type Backup } from './store';
import { type Box, type Note, type Stroke, pageIndexAt } from './model';

export interface GitHubConfig {
  /** owner/name */
  repo: string;
  token: string;
}

/** 読み出し元(Store と同じ形) */
export interface NoteSource {
  listNotes(): Promise<Note[]>;
  strokesOf(noteId: string): Promise<Stroke[]>;
}

export interface BackupResult {
  /** 作った commit。変更がなければ null */
  commit: string | null;
  /** 書き込んだ・消したファイルの数 */
  files: number;
  /** ノートごとの note.json の内容のハッシュ(次回、変わっていないノートを読み飛ばすため) */
  state: Record<string, string>;
}

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const API = 'https://api.github.com';
const ROOT = 'notes/';
const PARALLEL = 4;

const round = (v: number) => Math.round(v * 100) / 100;
const enc = new TextEncoder();

/** UTF-8 の文字列と base64 の行き来(btoa / atob は 1 バイト文字しか扱えない) */
export const toBase64 = (text: string) => btoa(Array.from(enc.encode(text), b => String.fromCharCode(b)).join(''));
export const fromBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), ch => ch.charCodeAt(0)));

/** git が blob に付ける SHA-1。手元の内容と repo の内容を、ダウンロードせずに比べられる */
export async function gitBlobSha(text: string | Uint8Array): Promise<string> {
  const body = typeof text === 'string' ? enc.encode(text) : text, head = enc.encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(head.length + body.length);
  buf.set(head); buf.set(body, head.length);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  return Array.from(h, b => b.toString(16).padStart(2, '0')).join('');
}

export const notePath = (id: string) => `${ROOT}${id}/note.json`;
export const pagePath = (id: string, i: number) => `${ROOT}${id}/p${String(i + 1).padStart(4, '0')}.json`;

export function noteFile(note: Note): string {
  return JSON.stringify({ format: 'tsugigami-note', version: 1, note }, null, 1) + '\n';
}

/** ストロークをページに振り分ける(上端があるページ)。各ページの中は描く順 */
function pageGroups(note: Note, strokes: Stroke[]): Map<string, Stroke[]> {
  const byPage = new Map<number, Stroke[]>();
  for (const s of strokes) {
    const i = pageIndexAt(note, s.b[1]);
    let list = byPage.get(i);
    if (!list) byPage.set(i, list = []);
    list.push(s);
  }
  const out = new Map<string, Stroke[]>();
  for (const [i, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
    out.set(pagePath(note.id, i), list.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1)));
  }
  return out;
}

/** ノートのストロークをページごとのファイルにする。同じ内容なら同じ文字列になる(順序と丸めを固定) */
export function pageFiles(note: Note, strokes: Stroke[]): Map<string, string> {
  return new Map([...pageGroups(note, strokes)].map(([p, list]) => [p, pageText(list)]));
}

/**
 * ページのファイルの中身と sha の覚え書き。ストロークは書いた後に変わらない(変形や色替えは別の id になる)ので、
 * 載っている線の id の並びが同じなら中身も同じ。長いノートで、書いていないページを毎回作り直さないため。
 */
const pageCache = new Map<string, { key: string; text: string; sha: string }>();

async function cachedPage(path: string, list: Stroke[]): Promise<{ text: string; sha: string }> {
  const key = list.map(s => s.id).join(','), hit = pageCache.get(path);
  if (hit?.key === key) return hit;
  const text = pageText(list), v = { key, text, sha: await gitBlobSha(text) };
  pageCache.set(path, v);
  return v;
}

function pageText(list: Stroke[]): string {
  const lines = list.map(s => JSON.stringify({
    id: s.id, kind: s.kind, color: s.color, width: s.width, z: s.z,
    b: [Math.floor(s.b[0] * 100) / 100, Math.floor(s.b[1] * 100) / 100, Math.ceil(s.b[2] * 100) / 100, Math.ceil(s.b[3] * 100) / 100],
    pts: Array.from(s.pts, round),
  }));
  return `{"format":"tsugigami-page","version":1,"strokes":[\n${lines.join(',\n')}\n]}\n`;
}

function readme(notes: Note[]): string {
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  const rows = notes
    .slice().sort((a, b) => b.updated - a.updated)
    .map(n => `| [${n.title.replace(/[|[\]]/g, ' ')}](${ROOT}${n.id}/) | ${fmt(n.updated)} UTC | ${n.pages.length} |${n.trashed ? ' ゴミ箱 |' : ' |'}`);
  return [
    '# tsugigami のノート',
    '',
    '[tsugigami](https://nishio.github.io/tsugigami/) が自動で書き込むバックアップです。手で編集しないでください。',
    'アプリのノート一覧の「GitHub から読み込む」で、この内容を iPad に戻せます。',
    '',
    '| ノート | 更新 | ページ | |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

async function pool<T>(items: T[], f: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (i < items.length) await f(items[i++]);
  }));
}

interface TreeEntry { path: string; type: string; sha: string }

export class GitHubBackup {
  private branch: string | null = null;

  constructor(private cfg: GitHubConfig, private fetchImpl: Fetch = (i, o) => fetch(i, o)) {}

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}/repos/${this.cfg.repo}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.cfg.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      throw new GitHubError('GitHub につながりません(オフライン?)', 0);
    }
    if (res.ok) return res.status === 204 ? (undefined as T) : res.json() as Promise<T>;
    const msg = await res.json().then((j: { message?: string }) => j.message ?? '', () => '');
    const why =
      res.status === 401 ? 'トークンが無効か、期限が切れています' :
      res.status === 403 ? 'トークンの権限が足りません(Contents の Read and write が要ります)' :
      res.status === 404 ? 'repo が見つかりません(名前か、トークンが対象にしている repo を確かめてください)' :
      `GitHub がエラーを返しました(${res.status})`;
    throw new GitHubError(`${why}${msg ? ': ' + msg : ''}`, res.status);
  }

  /** repo に届くか確かめ、既定のブランチを覚える */
  async check(): Promise<string> {
    const r = await this.api<{ default_branch: string }>('GET', '');
    this.branch = r.default_branch;
    return r.default_branch;
  }

  /** いまの先頭の commit。空の repo なら最初の commit を作る */
  private async head(): Promise<{ commit: string; tree: string }> {
    const branch = this.branch ?? await this.check();
    let ref: { object: { sha: string } };
    try {
      ref = await this.api('GET', `/git/ref/heads/${branch}`);
    } catch (e) {
      // 空の repo(409)では git の API が使えないので、README を 1 つ置いて始める
      if (!(e instanceof GitHubError) || (e.status !== 409 && e.status !== 404)) throw e;
      await this.api('PUT', '/contents/README.md', {
        message: 'tsugigami: バックアップを始める',
        content: toBase64('# tsugigami のノート\n'),
        branch,
      });
      ref = await this.api('GET', `/git/ref/heads/${branch}`);
    }
    const c = await this.api<{ tree: { sha: string } }>('GET', `/git/commits/${ref.object.sha}`);
    return { commit: ref.object.sha, tree: c.tree.sha };
  }

  private async files(tree: string): Promise<Map<string, string>> {
    const t = await this.api<{ tree: TreeEntry[] }>('GET', `/git/trees/${tree}?recursive=1`);
    return new Map(t.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha]));
  }

  /**
   * 手元のノートを repo に書き込む。
   * prev は前回の state(変わっていないノートはストロークを読まずに飛ばす)。removed は手元で完全に削除したノートの id。
   */
  async backup(src: NoteSource, prev: Record<string, string> = {}, removed: string[] = [], now = Date.now()): Promise<BackupResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.backupOnce(src, prev, removed, now);
      } catch (e) {
        // 別の端末が先に書き込んで先頭が進んでいた(fast-forward できない)ら、もう一度最初から
        if (e instanceof GitHubError && e.status === 422 && attempt < 2) continue;
        throw e;
      }
    }
  }

  private async backupOnce(src: NoteSource, prev: Record<string, string>, removed: string[], now: number): Promise<BackupResult> {
    const head = await this.head();
    const remote = await this.files(head.tree);
    const notes = await src.listNotes();
    const want = new Map<string, { text: string; sha?: string }>(); // path -> 内容(読み飛ばさなかったノートの分)
    const keep = new Set<string>();         // 手元が正しいと分かっている path
    const state: Record<string, string> = {};
    want.set('README.md', { text: readme(notes) });
    keep.add('README.md');

    for (const note of notes) {
      const nf = noteFile(note), nsha = await gitBlobSha(nf), np = notePath(note.id);
      state[note.id] = nsha;
      const folder = `${ROOT}${note.id}/`;
      if (prev[note.id] === nsha && remote.get(np) === nsha) {
        // 前回から変わっていない。repo にあるそのノートのファイルはそのまま
        for (const p of remote.keys()) if (p.startsWith(folder)) keep.add(p);
        continue;
      }
      want.set(np, { text: nf, sha: nsha }); keep.add(np);
      for (const [p, list] of pageGroups(note, await src.strokesOf(note.id))) { want.set(p, await cachedPage(p, list)); keep.add(p); }
    }

    const changes: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
    const upload: [string, string][] = [];
    for (const [path, f] of want) {
      if (remote.get(path) === (f.sha ?? await gitBlobSha(f.text))) continue;
      upload.push([path, f.text]);
    }
    await pool(upload, async ([path, text]) => {
      const b = await this.api<{ sha: string }>('POST', '/git/blobs', { content: text, encoding: 'utf-8' });
      changes.push({ path, mode: '100644', type: 'blob', sha: b.sha });
    });
    // 手元にあるノートで、もう線の無いページのファイル。完全に削除したノートのファイル
    const local = new Set(notes.map(n => n.id)), gone = new Set(removed.filter(id => !local.has(id)));
    for (const path of remote.keys()) {
      if (!path.startsWith(ROOT)) continue;
      const id = path.slice(ROOT.length).split('/')[0];
      if ((local.has(id) && !keep.has(path)) || gone.has(id)) changes.push({ path, mode: '100644', type: 'blob', sha: null });
    }
    if (!changes.length) return { commit: null, files: 0, state };

    changes.sort((a, b) => (a.path < b.path ? -1 : 1));
    const tree = await this.api<{ sha: string }>('POST', '/git/trees', { base_tree: head.tree, tree: changes });
    const edited = new Set(changes.filter(c => c.path.startsWith(ROOT)).map(c => c.path.split('/')[1]));
    const commit = await this.api<{ sha: string }>('POST', '/git/commits', {
      message: `tsugigami: ${edited.size} 冊を更新 (${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
      tree: tree.sha,
      parents: [head.commit],
    });
    await this.api('PATCH', `/git/refs/heads/${this.branch}`, { sha: commit.sha, force: false });
    return { commit: commit.sha, files: changes.length, state };
  }

  /** repo の内容を読み出して、バックアップファイルと同じ形にする(Store.importAll に渡す) */
  async restore(now = Date.now()): Promise<Backup> {
    const head = await this.head();
    const remote = await this.files(head.tree);
    const paths = [...remote.keys()].filter(p => p.startsWith(ROOT) && p.endsWith('.json'));
    const text = new Map<string, string>();
    await pool(paths, async p => {
      const b = await this.api<{ content: string }>('GET', `/git/blobs/${remote.get(p)}`);
      text.set(p, fromBase64(b.content));
    });
    const notes: Note[] = [], strokes: Backup['strokes'] = [];
    for (const p of paths) {
      const id = p.slice(ROOT.length).split('/')[0], data = JSON.parse(text.get(p)!);
      if (data.format === 'tsugigami-note') notes.push(data.note as Note);
      else if (data.format === 'tsugigami-page') {
        for (const s of data.strokes as (Omit<Stroke, 'pts' | 'noteId' | 'b'> & { pts: number[]; b: Box })[]) strokes.push({ ...s, noteId: id });
      }
    }
    return { format: 'tsugigami-backup', version: 1, exported: now, notes, strokes };
  }
}
