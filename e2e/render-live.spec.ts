// 計測用(一時): JSON の 1 本を合成 PointerEvent で書き、書いている最中(ライブ層)と書き終わり(タイル)の画面を保存する
import { readFileSync } from 'node:fs';
import { test } from '@playwright/test';

const src = process.env.RENDER_JSON;
test.skip(!src, 'RENDER_JSON が無いので飛ばす');

test('ライブ層とタイルを撮る', async ({ page, browserName }) => {
  const data = JSON.parse(readFileSync(src!, 'utf8')) as { strokes: { z: number; pts: number[] }[] };
  const z = Number(process.env.RENDER_Z ?? 132);
  const pts = data.strokes.find(s => s.z === z)!.pts;
  const out = process.env.RENDER_OUT ?? 'test-results';
  const [x0, y0, x1, y1, s = 1] = (process.env.RENDER_VIEW ?? '0,0,794,1123,1').split(',').map(Number);
  await page.goto('./');
  await page.waitForFunction(() => !!(window as any).tsugigami?.doc);
  const pad = 20;
  await page.evaluate(({ s, x0, y0 }) => { const r = (window as any).tsugigami.r; r.view = { s, x: -x0 * s, y: -y0 * s }; r.settle(); }, { s, x0: x0 - pad, y0: y0 - pad });
  await page.waitForTimeout(500);
  const st = (await page.locator('#stage').boundingBox())!;
  // 表示位置は clampView で動くことがあるので、実際の view から切り出す場所を決める
  const view = await page.evaluate(() => (window as any).tsugigami.r.view as { x: number; y: number; s: number });
  const clip = { x: st.x + (x0 - pad) * view.s + view.x, y: st.y + (y0 - pad) * view.s + view.y, width: (x1 - x0 + 2 * pad) * s, height: (y1 - y0 + 2 * pad) * s };
  // 1 回の move に 3 点ずつ(合体イベント相当)を 10 ms おきに流す。pointerdown のあと途中で撮る
  await page.evaluate(async ({ pts }) => {
    const r = (window as any).tsugigami.r, st = document.querySelector('#stage')!, b = st.getBoundingClientRect();
    const toScreen = (i: number) => { const x = pts[i * 3] * r.view.s + r.view.x, y = pts[i * 3 + 1] * r.view.s + r.view.y; return [b.left + x, b.top + y]; };
    const ev = (name: string, i: number, buttons: number) => { const [cx, cy] = toScreen(i); st.dispatchEvent(new PointerEvent(name, { bubbles: true, pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: cx, clientY: cy, pressure: buttons ? 0.3 : 0, buttons })); };
    const n = pts.length / 3;
    ev('pointerdown', 0, 1);
    for (let i = 1; i < n; i++) { ev('pointermove', i, 1); if (i % 30 === 0) await new Promise(f => setTimeout(f, 5)); }
    (window as any).__last = n - 1;
  }, { pts });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/live-${browserName}.png`, scale: 'device', clip });
  await page.evaluate(({ pts }) => {
    const r = (window as any).tsugigami.r, st = document.querySelector('#stage')!, b = st.getBoundingClientRect();
    const i = pts.length / 3 - 1, x = pts[i * 3] * r.view.s + r.view.x, y = pts[i * 3 + 1] * r.view.s + r.view.y;
    st.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: b.left + x, clientY: b.top + y, pressure: 0, buttons: 0 }));
  }, { pts });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/baked-${browserName}.png`, scale: 'device', clip });
  console.log(browserName, await page.evaluate(() => { const t = (window as any).tsugigami; const ss = [...t.doc.strokes.values()]; return JSON.stringify({ n: ss.length, b: ss.map((s: any) => s.b.map(Math.round)), npts: ss.map((s: any) => s.pts.length / 3), view: t.r.view, note: t.doc.note.pages.length, W: t.r.W, H: t.r.H }); }), JSON.stringify(clip));
});
