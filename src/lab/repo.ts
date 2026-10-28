// lab(実験機)が GitHub の repo と話す部分。
// AI が experiments/queue/<id>.js を置き、iPad がそれを拾って実行し、experiments/results/<id>/ に結果を commit する。
// バックアップ(github.ts)とは別物。ノートのファイルには触らない。
import { fromBase64, gitBlobSha, toBase64 } from '../github';

export interface LabConfig { repo: string; token: string }

export const QUEUE = 'experiments/queue/';
export const RESULTS = 'experiments/results/';

export type LabFile = { text: string } | { bytes: Uint8Array };

export interface QueueEntry { id: string; path: string; sha: string }

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const API = 'https://api.github.com';

export class LabRepoError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const bytesToBase64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

export class LabRepo {
  private branch: string | null = null;

  constructor(private cfg: LabConfig, private fetchImpl: Fetch = (i, o) => fetch(i, o)) {}

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
      throw new LabRepoError('GitHub につながりません', 0);
    }
    if (res.ok) return res.status === 204 ? (undefined as T) : res.json() as Promise<T>;
    const msg = await res.json().then((j: { message?: string }) => j.message ?? '', () => '');
    throw new LabRepoError(`GitHub ${res.status}${msg ? ': ' + msg : ''}`, res.status);
  }

  async check(): Promise<string> {
    const r = await this.api<{ default_branch: string }>('GET', '');
    this.branch = r.default_branch;
    return r.default_branch;
  }

  /** 待っている実験(名前順) */
  async queue(): Promise<QueueEntry[]> {
    let list: { name: string; path: string; sha: string; type: string }[];
    try {
      list = await this.api('GET', `/contents/${QUEUE.slice(0, -1)}`);
    } catch (e) {
      if (e instanceof LabRepoError && e.status === 404) return [];
      throw e;
    }
    return list
      .filter(f => f.type === 'file' && f.name.endsWith('.js'))
      .map(f => ({ id: f.name.slice(0, -3), path: f.path, sha: f.sha }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async read(path: string): Promise<string> {
    const f = await this.api<{ content: string; encoding: string }>('GET', `/contents/${path}`);
    return fromBase64(f.content);
  }

  private async head(): Promise<{ commit: string; tree: string }> {
    const branch = this.branch ?? await this.check();
    const ref = await this.api<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`);
    const c = await this.api<{ tree: { sha: string } }>('GET', `/git/commits/${ref.object.sha}`);
    return { commit: ref.object.sha, tree: c.tree.sha };
  }

  /** ファイルを書き、消し、1 つの commit にする。先頭が進んでいたら最初からやり直す */
  async commit(files: Map<string, LabFile>, deletes: string[], message: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.commitOnce(files, deletes, message);
      } catch (e) {
        if (e instanceof LabRepoError && e.status === 422 && attempt < 2) continue;
        throw e;
      }
    }
  }

  private async commitOnce(files: Map<string, LabFile>, deletes: string[], message: string): Promise<string> {
    const head = await this.head();
    const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
    for (const [path, f] of files) {
      const body = 'text' in f ? { content: f.text, encoding: 'utf-8' } : { content: bytesToBase64(f.bytes), encoding: 'base64' };
      const b = await this.api<{ sha: string }>('POST', '/git/blobs', body);
      tree.push({ path, mode: '100644', type: 'blob', sha: b.sha });
    }
    for (const path of deletes) tree.push({ path, mode: '100644', type: 'blob', sha: null });
    const t = await this.api<{ sha: string }>('POST', '/git/trees', { base_tree: head.tree, tree });
    const c = await this.api<{ sha: string }>('POST', '/git/commits', { message, tree: t.sha, parents: [head.commit] });
    await this.api('PATCH', `/git/refs/heads/${this.branch}`, { sha: c.sha, force: false });
    return c.sha;
  }
}

export { gitBlobSha, toBase64 };
