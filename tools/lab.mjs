#!/usr/bin/env node
// AI 側から lab(iPad で開いた ?lab=1 のページ)に実験を頼む。GitHub の非公開 repo を経由する。
//
//   node tools/lab.mjs queue <script.js> [id]    実験を待ち行列に置く(id 省略時は 日時-ファイル名)
//   node tools/lab.mjs ls                        待ち行列と結果の一覧
//   node tools/lab.mjs wait <id> [秒]            結果が来るまで待って lab-results/<id>/ に落とす(既定 900 秒)
//   node tools/lab.mjs run <script.js> [秒]      queue + wait
//   node tools/lab.mjs fetch <id>                結果を落とすだけ
//
// repo は環境変数 LAB_REPO(既定 nishio/tsugigami-notes)。認証は gh CLI(gh auth login 済みであること)。
// スクリプトは「async 関数の本文」。引数 `lab` で本物のアプリを動かす(src/lab/api.ts)。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const REPO = process.env.LAB_REPO ?? 'nishio/tsugigami-notes';
const OUT = process.env.LAB_OUT ?? 'lab-results';
const QUEUE = 'experiments/queue', RESULTS = 'experiments/results';

function gh(args, { raw = false, ok404 = false } = {}) {
  const r = spawnSync('gh', ['api', ...args], { encoding: raw ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const err = String(r.stderr);
    if (ok404 && /404|Not Found/.test(err)) return null;
    throw new Error(`gh api ${args.join(' ')}: ${err.trim()}`);
  }
  return raw ? r.stdout : JSON.parse(r.stdout || 'null');
}

const list = dir => gh([`repos/${REPO}/contents/${dir}`], { ok404: true }) ?? [];

function queue(file, id) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  id ??= `${stamp}-${basename(file).replace(/\.js$/, '')}`;
  const content = readFileSync(file).toString('base64');
  gh(['-X', 'PUT', `repos/${REPO}/contents/${QUEUE}/${id}.js`, '-f', `message=lab: queue ${id}`, '-f', `content=${content}`]);
  console.log(id);
  return id;
}

function fetchResult(id) {
  const files = list(`${RESULTS}/${id}`);
  if (!files.length) return null;
  const dir = join(OUT, id);
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    if (f.type !== 'file') continue;
    // raw 出力は PNG などで「invalid UTF-8 string」になるので、blob を base64 で受けて自分で戻す
    const blob = gh([`repos/${REPO}/git/blobs/${f.sha}`]);
    writeFileSync(join(dir, f.name), Buffer.from(blob.content, 'base64'));
  }
  return dir;
}

async function wait(id, seconds = 900) {
  const t0 = Date.now();
  process.stderr.write(`${id} を待つ(最長 ${seconds} 秒)`);
  while (Date.now() - t0 < seconds * 1000) {
    const dir = fetchResult(id);
    if (dir) {
      process.stderr.write('\n');
      const st = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'));
      console.log(`${st.ok ? 'ok' : 'error'} → ${dir}`);
      if (!st.ok) console.log(st.error);
      if (existsSync(join(dir, 'log.txt'))) console.log(readFileSync(join(dir, 'log.txt'), 'utf8'));
      return dir;
    }
    process.stderr.write('.');
    await new Promise(f => setTimeout(f, 15000));
  }
  process.stderr.write('\n');
  throw new Error('時間切れ。iPad で ?lab=1 のページが開いているか確かめる');
}

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'queue') queue(a, b);
  else if (cmd === 'ls') {
    console.log('待ち行列:'); for (const f of list(QUEUE)) console.log('  ' + f.name);
    console.log('結果:'); for (const f of list(RESULTS)) console.log('  ' + f.name);
  } else if (cmd === 'wait') await wait(a, b ? Number(b) : undefined);
  else if (cmd === 'run') await wait(queue(a), b ? Number(b) : undefined);
  else if (cmd === 'fetch') console.log(fetchResult(a) ?? '結果がまだ無い');
  else { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n')); process.exit(1); }
} catch (e) { console.error(e.message); process.exit(1); }
