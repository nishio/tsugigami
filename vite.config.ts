import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// public/ 以下でオフライン時にも必要なもの(バンドルに入らないので手で列挙する)
const PUBLIC_FILES = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const builtAt = new Date().toISOString();
const commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
const build = { id: `${commit}-${builtAt}`, commit, builtAt };

// ビルド成果物の一覧から Service Worker を生成する。
// 通常の起動はキャッシュから。公開版の確認だけは必ずネットワークへ出す。
function serviceWorker(): Plugin {
  return {
    name: 'tsugigami-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      // cache.addAll は同じ URL が 2 回あると全体が失敗する(index.html はバンドルにも入っている)
      const files = [...new Set(['./', 'index.html', ...PUBLIC_FILES, ...Object.keys(bundle)])].filter(f => !f.endsWith('.map'));
      // public/ のファイルは名前が変わらないので、中身も版に含める(アイコンや manifest の変更を配る)
      const h = createHash('sha256').update(files.sort().join('\n'));
      for (const f of PUBLIC_FILES) h.update(readFileSync(resolve('public', f)));
      const version = h.digest('hex').slice(0, 12);
      const source = `const BUILD = ${JSON.stringify(build)};
const CACHE = 'tsugigami-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('tsugigami-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data === 'BUILD') e.ports[0]?.postMessage(BUILD.id);
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname === new URL('version.json', self.registration.scope).pathname) {
    e.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { cacheName: CACHE, ignoreVary: true }).then(r => r || fetch(req)));
    return;
  }
  // Vary(Origin など)で外れないようにする。モジュールの script 要求には Origin が付く
  e.respondWith(caches.match(req, { ignoreVary: true }).then(r => r || fetch(req)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build) });
    },
  };
}

export default defineConfig({
  base: '/tsugigami/',
  define: { __BUILD__: JSON.stringify(build) },
  plugins: [serviceWorker()],
  build: { target: 'safari16', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
