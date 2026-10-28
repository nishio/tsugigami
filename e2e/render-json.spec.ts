// 計測用: 書き出した JSON を本体の描画(タイル・Path2D)で描いて、画面の画像を保存する。
// 普段の e2e では走らない。使い方:
//   RENDER_JSON=raw/xxx.json RENDER_OUT=/tmp/out RENDER_VIEW=58,1653,225,1754,1.19 npx playwright test render-json
// RENDER_VIEW は ノート座標の x0,y0,x1,y1 と倍率(省略時 1)。RENDER_NOTE でノートの題名を指定(省略時 JSON の最初のノート)。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';

const src = process.env.RENDER_JSON;
test.skip(!src, 'RENDER_JSON が無いので飛ばす');

test('JSON を本体の描画で描いて撮る', async ({ page, browserName }) => {
  const path = resolve(src!);
  const data = JSON.parse(readFileSync(path, 'utf8')) as { notes: { title: string }[] };
  const title = process.env.RENDER_NOTE ?? data.notes[0].title;
  const [x0, y0, x1, y1, s = 1] = (process.env.RENDER_VIEW ?? '0,0,794,1123,1').split(',').map(Number);
  const out = process.env.RENDER_OUT ?? 'test-results';
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).tsugigami?.doc);
  await page.setInputFiles('#importFile', path);
  await page.waitForTimeout(1500);
  await page.click('#menuBtn');
  await page.click(`#noteList button.open:has-text("${title}")`);
  await page.waitForTimeout(500);
  const pad = 20;
  await page.evaluate(({ s, x0, y0 }) => {
    const r = (window as any).tsugigami.r;
    r.view = { s, x: -x0 * s, y: -y0 * s };
    r.settle();
  }, { s, x0: x0 - pad, y0: y0 - pad });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => { const r = (window as any).tsugigami.r; return { view: r.view, rs: r.rs, dpr: r.dpr }; });
  console.log(browserName, JSON.stringify(info));
  const st = (await page.locator('#stage').boundingBox())!;
  await page.screenshot({ path: `${out}/render-${browserName}.png`, scale: 'device', clip: { x: st.x, y: st.y, width: (x1 - x0 + 2 * pad) * s, height: (y1 - y0 + 2 * pad) * s } });
});
