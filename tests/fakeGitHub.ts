// テスト用の、メモリ上の GitHub(git data API のうち tsugigami が使う分だけ)。
// blob の sha は本物の git と同じ計算なので、手元と repo の比較がそのまま試せる。
import { fromBase64, gitBlobSha, toBase64 } from '../src/github';

interface Commit { tree: string; parents: string[]; message: string }

export class FakeGitHub {
  blobs = new Map<string, string>();
  /** tree の sha -> (path -> blob の sha) */
  trees = new Map<string, Map<string, string>>();
  commits = new Map<string, Commit>();
  ref: string | null = null;
  calls: string[] = [];
  private seq = 0;

  constructor(readonly repo = 'me/notes', readonly token = 'secret') {}

  private id(prefix: string): string { return prefix + (++this.seq).toString(16).padStart(8, '0'); }

  /** 先頭の commit のファイル(path -> 内容) */
  files(): Map<string, string> {
    if (!this.ref) return new Map();
    const t = this.trees.get(this.commits.get(this.ref)!.tree)!;
    return new Map([...t].map(([p, sha]) => [p, this.blobs.get(sha)!]));
  }

  /** 別の端末が書き込んだことにする */
  async pushFromElsewhere(path: string, text: string): Promise<void> {
    const sha = await gitBlobSha(text);
    this.blobs.set(sha, text);
    const base = this.ref ? this.trees.get(this.commits.get(this.ref)!.tree)! : new Map<string, string>();
    const t = new Map(base); t.set(path, sha);
    const ts = this.id('t'); this.trees.set(ts, t);
    const c = this.id('c'); this.commits.set(c, { tree: ts, parents: this.ref ? [this.ref] : [], message: 'elsewhere' });
    this.ref = c;
  }

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const prefix = `https://api.github.com/repos/${this.repo}`;
    if (!url.startsWith(prefix)) return json(404, { message: 'Not Found' });
    if (headers.get('Authorization') !== `Bearer ${this.token}`) return json(401, { message: 'Bad credentials' });
    const path = url.slice(prefix.length), body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push(`${method} ${path}`);
    let m: RegExpMatchArray | null;

    if (method === 'GET' && path === '') return json(200, { default_branch: 'main' });
    if (method === 'GET' && path === '/git/ref/heads/main') {
      return this.ref ? json(200, { object: { sha: this.ref } }) : json(409, { message: 'Git Repository is empty.' });
    }
    if (method === 'PUT' && path === '/contents/README.md') {
      await this.pushFromElsewhere('README.md', fromBase64(body.content));
      return json(201, {});
    }
    if (method === 'GET' && (m = path.match(/^\/git\/commits\/(\w+)$/))) {
      const c = this.commits.get(m[1]);
      return c ? json(200, { sha: m[1], tree: { sha: c.tree } }) : json(404, {});
    }
    if (method === 'GET' && (m = path.match(/^\/git\/trees\/(\w+)\?recursive=1$/))) {
      const t = this.trees.get(m[1])!;
      const dirs = new Set([...t.keys()].flatMap(p => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
      return json(200, {
        truncated: false,
        tree: [...[...dirs].map(p => ({ path: p, type: 'tree', sha: 'x' })), ...[...t].map(([p, sha]) => ({ path: p, type: 'blob', sha }))],
      });
    }
    if (method === 'POST' && path === '/git/blobs') {
      const sha = await gitBlobSha(body.content);
      this.blobs.set(sha, body.content);
      return json(201, { sha });
    }
    if (method === 'GET' && (m = path.match(/^\/git\/blobs\/(\w+)$/))) {
      const text = this.blobs.get(m[1])!;
      return json(200, { content: toBase64(text).replace(/(.{60})/g, '$1\n'), encoding: 'base64' });
    }
    if (method === 'POST' && path === '/git/trees') {
      const t = new Map(this.trees.get(body.base_tree) ?? []);
      for (const e of body.tree) {
        if (e.sha === null) t.delete(e.path);
        else { if (!this.blobs.has(e.sha)) return json(422, { message: 'blob not found' }); t.set(e.path, e.sha); }
      }
      const sha = this.id('t'); this.trees.set(sha, t);
      return json(201, { sha });
    }
    if (method === 'POST' && path === '/git/commits') {
      const sha = this.id('c'); this.commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message });
      return json(201, { sha });
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      const c = this.commits.get(body.sha)!;
      if (!body.force && !c.parents.includes(this.ref!)) return json(422, { message: 'Update is not a fast forward' });
      this.ref = body.sha;
      return json(200, { object: { sha: body.sha } });
    }
    return json(404, { message: `fake: ${method} ${path}` });
  };
}
