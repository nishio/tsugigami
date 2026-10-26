import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// public/ 以下でオフライン時にも必要なもの(バンドルに入らないので手で列挙する)
const PUBLIC_FILES = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

// ビルド成果物の一覧から Service Worker を生成する。
// 起動を速くするため、画面遷移は常にキャッシュから返し、新版は次回起動で切り替わる。
function serviceWorker(): Plugin {
  return {
    name: 'tsugigami-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', 'index.html', ...PUBLIC_FILES, ...Object.keys(bundle)].filter(f => !f.endsWith('.map'));
      const version = createHash('sha256').update(files.sort().join('\n')).digest('hex').slice(0, 12);
      const source = `const CACHE = 'tsugigami-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('tsugigami-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { cacheName: CACHE }).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: '/tsugigami/',
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  plugins: [serviceWorker()],
  build: { target: 'safari16', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
