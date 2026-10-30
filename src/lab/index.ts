// 実験機(lab)。`?lab=1` で開いたときだけ main.ts から読み込まれる。
// GitHub の非公開 repo の experiments/queue/ を見張り、スクリプトを拾って本物のアプリ上で実行し、
// 結果を experiments/results/<id>/ に commit する。スクリプトを置けるのはトークンを持つ本人だけ。
import './lab.css';
import { Store } from '../store';
import { type Lab, type Outputs, type TsugigamiApp, makeLab } from './api';
import { type LabConfig, LabRepo, LabRepoError, type QueueEntry, RESULTS } from './repo';

const DONE_KEY = 'lab:done';

export async function startLab(app: TsugigamiApp, stage: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const pollMs = Math.max(1, Number(params.get('poll') || 10)) * 1000;

  // ---- 画面 ----
  const root = document.createElement('section');
  root.id = 'lab';
  root.innerHTML = `
    <div class="lab-head"><b>lab</b> <span class="lab-status">準備中</span><span class="lab-grow"></span>
      <button type="button" class="lab-check">いま見る</button><button type="button" class="lab-abort" hidden>中止</button></div>
    <div class="lab-msg" hidden></div>
    <button type="button" class="lab-next" hidden>次へ</button>
    <form class="lab-cfg" hidden>
      <input class="lab-repo" placeholder="owner/repo" autocapitalize="off" autocorrect="off">
      <input class="lab-token" placeholder="token" type="password">
      <button type="submit">使う</button>
    </form>
    <pre class="lab-log"></pre>`;
  document.body.append(root);
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
  const status = (t: string) => { $('.lab-status').textContent = t; };
  const logEl = $('.lab-log'), lines: string[] = [];
  const log = (line: string) => { lines.push(line); if (lines.length > 6) lines.shift(); logEl.textContent = lines.join('\n'); };
  const msg = $('.lab-msg'), next = $('.lab-next');
  const say = (text: string) => { msg.textContent = text; msg.hidden = !text; };
  let resolveAsk: (() => void) | null = null;
  const ask = (text: string) => new Promise<void>(f => { say(text); next.hidden = false; resolveAsk = f; });
  next.onclick = () => { next.hidden = true; say(''); resolveAsk?.(); resolveAsk = null; };

  // ---- 設定: 本体(自動バックアップ)の repo とトークンをそのまま使う。無ければ入力してもらう ----
  let cfg: LabConfig | null = null;
  try { cfg = (await (await Store.open('tsugigami')).getMeta<LabConfig>('github')) ?? null; } catch { /* 本体の保存領域が無い */ }
  if (!cfg) cfg = (await app.store.getMeta<LabConfig>('lab:github')) ?? null;
  const form = $<HTMLFormElement>('.lab-cfg');
  if (!cfg) {
    form.hidden = false;
    status('repo とトークンを入れてください');
    cfg = await new Promise<LabConfig>(f => {
      form.onsubmit = e => {
        e.preventDefault();
        f({ repo: $<HTMLInputElement>('.lab-repo').value.trim(), token: $<HTMLInputElement>('.lab-token').value.trim() });
      };
    });
    await app.store.setMeta('lab:github', cfg);
    form.hidden = true;
  }
  const repo = new LabRepo(cfg);
  try { await repo.check(); } catch (e) { status('GitHub に届きません: ' + String((e as Error).message)); return; }

  // ---- 見張りと実行 ----
  const done = new Set<string>(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as string[]);
  let running: QueueEntry | null = null;
  let abort = false;
  $('.lab-abort').onclick = () => { abort = true; resolveAsk?.(); };

  async function run(entry: QueueEntry): Promise<void> {
    running = entry; abort = false;
    $('.lab-abort').hidden = false;
    status(`実行中: ${entry.id}`);
    log(`▶ ${entry.id}`);
    const out: Outputs = { files: new Map(), log: [] };
    const started = new Date().toISOString();
    const lab: Lab = makeLab(app, stage, { say, ask, log }, out);
    let ok = false, error = '', returned: unknown = null;
    const script = await repo.read(entry.path);
    try {
      const fn = new Function('lab', `return (async () => {\n${script}\n})();`) as (lab: Lab) => Promise<unknown>;
      returned = await Promise.race([fn(lab), new Promise((_, rej) => { const t = setInterval(() => { if (abort) { clearInterval(t); rej(new Error('中止')); } }, 200); })]);
      ok = true;
    } catch (e) {
      error = `${(e as Error)?.message ?? String(e)}\n${(e as Error)?.stack ?? ''}`.trim(); // Safari の stack にはメッセージが入らない
      log('✗ ' + ((e as Error)?.message ?? String(e)));
    }
    say('');
    next.hidden = true;
    const dir = RESULTS + entry.id + '/';
    const files = new Map([...out.files].map(([n, f]) => [dir + n, f]));
    files.set(dir + 'status.json', { text: JSON.stringify({ id: entry.id, ok, error, started, finished: new Date().toISOString(), env: lab.env(), returned }, null, 1) + '\n' });
    files.set(dir + 'log.txt', { text: out.log.join('\n') + '\n' });
    files.set(dir + 'script.js', { text: script });
    status(`送信中: ${entry.id}`);
    try {
      await repo.commit(files, [entry.path], `lab: ${entry.id} ${ok ? 'ok' : 'error'}`);
      log(`✓ ${entry.id} を送った(${files.size} ファイル)`);
    } catch (e) {
      log('送れなかった: ' + String((e as Error).message));
      throw e;
    } finally {
      done.add(entry.id);
      localStorage.setItem(DONE_KEY, JSON.stringify([...done].slice(-200)));
      running = null;
      $('.lab-abort').hidden = true;
    }
  }

  let checking = false;
  async function check(): Promise<void> {
    if (checking || running || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const q = (await repo.queue()).filter(e => !done.has(e.id));
      status(q.length ? `${q.length} 件待ち` : `待機中 (${new Date().toLocaleTimeString()})`);
      if (q.length) await run(q[0]);
    } catch (e) {
      status('エラー: ' + ((e as Error).message ?? String(e)));
      if (!(e instanceof LabRepoError)) console.error(e);
    } finally {
      checking = false;
    }
  }
  $('.lab-check').onclick = () => { check(); };
  setInterval(check, pollMs);
  check();
}
