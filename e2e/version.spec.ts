import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { expect, test } from '@playwright/test';

test.describe('版の確認表示', () => {
  test.use({ serviceWorkers: 'block' });

  test('実行中の版と確認時刻を表示し、公開版と一致すれば最新版と示す', async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(() => (window as any).tsugigami?.doc);
    await page.click('#menuBtn');
    await expect(page.locator('#version')).toContainText('使用中:');
    await expect(page.locator('#versionStatus')).toContainText('最新版です（');
    await expect(page.locator('#versionUpdate')).toBeHidden();
  });

  test('新版の通知だけでは再読み込みせず、通信失敗と不正な版は確認できないと示す', async ({ page }) => {
    let mode: 'new' | 'error' | 'invalid' = 'new';
    await page.route('**/version.json?*', async route => {
      if (mode === 'error') return route.abort();
      if (mode === 'invalid') return route.fulfill({ json: { id: 'bad' } });
      await route.fulfill({ json: { id: 'new', commit: 'new', builtAt: '2026-11-21T00:00:00Z' } });
    });
    await page.goto('./'); await page.waitForFunction(() => (window as any).tsugigami?.doc);
    await page.click('#menuBtn');
    const note = await page.evaluate(() => (window as any).tsugigami.doc.note.id);
    await expect(page.locator('#versionStatus')).toContainText('新版があります');
    await expect(page.locator('#versionUpdate')).toBeVisible();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).tsugigami.doc.note.id)).toBe(note);
    mode = 'error'; await page.click('#versionCheck');
    await expect(page.locator('#versionStatus')).toContainText('確認できません');
    await expect(page.locator('#versionUpdate')).toBeHidden();
    mode = 'invalid'; await page.click('#versionCheck');
    await expect(page.locator('#versionStatus')).toContainText('確認できません');
    expect(await page.evaluate(() => (window as any).tsugigami.doc.note.id)).toBe(note);
  });

  test('更新ボタンで再確認に失敗したら画面を維持して操作を戻す', async ({ page }) => {
    let fail = false;
    await page.route('**/version.json?*', route => fail ? route.abort() : route.fulfill({
      json: { id: 'new', commit: 'new', builtAt: '2026-11-21T00:00:00Z' },
    }));
    await page.goto('./'); await page.waitForFunction(() => (window as any).tsugigami?.doc);
    await page.click('#menuBtn'); await expect(page.locator('#versionUpdate')).toBeVisible();
    fail = true; await page.click('#versionUpdate');
    await expect(page.locator('#updateWait')).toBeHidden();
    await expect(page.locator('#versionUpdate')).toBeEnabled();
    await expect(page.locator('#toast')).toBeVisible();
    await expect(page.locator('#drawer')).toBeVisible();
  });
});

// 同じ URL の配信内容を A → B に切り替え、実際の SW とキャッシュで更新を再現する。
test('SW が新版を取得してから保存完了を待ち、版を切り替えて線を残す', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service Worker の更新は Chromium で確認する');
  const initial = JSON.parse(readFileSync('dist/version.json', 'utf8'));
  const next = { commit: 'bbbbbbb', builtAt: new Date(Date.parse(initial.builtAt) + 1000).toISOString(), id: '' };
  next.id = `${next.commit}-${next.builtAt}`;
  let published = false;
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname).replace(/^\/tsugigami\//, '') || 'index.html';
    const file = resolve('dist', path);
    if (!file.startsWith(resolve('dist') + '/') && !file.startsWith(resolve('dist') + String.fromCharCode(92))) {
      res.writeHead(404).end(); return;
    }
    try {
      const ext = extname(file), text = ['.html', '.js', '.json', '.css', '.webmanifest'].includes(ext);
      let body: string | Buffer = readFileSync(file);
      if (text) {
        body = body.toString();
        if (published) {
          body = body.split(initial.commit).join(next.commit).split(initial.builtAt).join(next.builtAt);
          if (path === 'sw.js') body = body.replace(/const CACHE = '([^']+)'/, "const CACHE = '$1-next'");
        }
      }
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json' } as Record<string, string>)[ext] ?? 'image/png', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  try {
    const address = server.address() as { port: number };
    await page.goto(`http://127.0.0.1:${address.port}/tsugigami/`);
    await page.waitForFunction(() => (window as any).tsugigami?.doc && navigator.serviceWorker.controller);
    await page.click('#menuBtn'); await expect(page.locator('#versionStatus')).toContainText('最新版です');
    published = true; await page.click('#versionCheck');
    await expect(page.locator('#versionStatus')).toContainText('新版があります');
    await expect(page.locator('#version')).not.toContainText(next.commit);
    // 書きかけの線を作り、保存完了を意図的に止める。
    await page.evaluate(() => {
      const app = (window as any).tsugigami, stage = document.querySelector('#stage')!, r = stage.getBoundingClientRect();
      for (const [type, x] of [['pointerdown', 100], ['pointermove', 300]] as const) {
        stage.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'pen', clientX: r.left + x, clientY: r.top + 200, buttons: 1, pressure: 0.5 }));
      }
      const flush = app.store.flush.bind(app.store);
      app.store.flush = async () => { await new Promise<void>(ok => (window as any).releaseSave = ok); await flush(); };
    });
    await page.click('#versionUpdate');
    await page.waitForFunction(() => (window as any).releaseSave);
    await expect(page.locator('#updateWait')).toBeVisible();
    await expect(page.locator('#version')).not.toContainText(next.commit);
    expect(await page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(1);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(1);
    await page.click('#updateCancel'); await expect(page.locator('#updateWait')).toBeHidden();
    await page.evaluate(() => { (window as any).releaseSave(); delete (window as any).releaseSave; });
    await page.waitForTimeout(200);
    await expect(page.locator('#version')).not.toContainText(next.commit);
    await page.click('#versionUpdate'); await page.waitForFunction(() => (window as any).releaseSave);
    await page.evaluate(() => (window as any).releaseSave());
    await page.waitForFunction(() => document.querySelector('#version')?.textContent?.includes('bbbbbbb'));
    await page.waitForFunction(() => (window as any).tsugigami?.doc);
    expect(await page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(1);
    await page.click('#menuBtn'); await expect(page.locator('#versionStatus')).toContainText('最新版です');
    await page.context().setOffline(true);
    await page.click('#versionCheck'); await expect(page.locator('#versionStatus')).toContainText('確認できません');
    await page.reload(); await page.waitForFunction(() => (window as any).tsugigami?.doc);
    expect(await page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(1);
    await page.click('#menuBtn'); await expect(page.locator('#versionStatus')).toContainText('確認できません');
  } finally { await new Promise<void>(ok => server.close(() => ok())); }
});
