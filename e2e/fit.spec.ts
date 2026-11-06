// fit(紙の幅 = 画面幅)を通常の表示にする。この状態では縦スクロールで横にずれない(raw/2026-11-06_iPadで使った感想_パームのundo_fit_アイコン_題名.md)。
import { expect, test, type Page } from '@playwright/test';

const view = (page: Page) => page.evaluate(() => { const { r } = (window as any).tsugigami; return { ...r.view, fit: r.fit, W: r.W }; });

/** 指で触れて動かす。pts は [x, y] の列(指ごと)。同じ長さの列を同時に進める */
const fingers = (page: Page, tracks: [number, number][][]) => page.evaluate(tracks => {
  const st = document.querySelector('#stage')!, b = st.getBoundingClientRect();
  const ev = (n: string, id: number, [x, y]: [number, number], buttons: number) =>
    st.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: 70 + id, pointerType: 'touch', clientX: b.left + x, clientY: b.top + y, buttons }));
  tracks.forEach((t, i) => ev('pointerdown', i, t[0], 1));
  for (let k = 1; k < tracks[0].length; k++) tracks.forEach((t, i) => ev('pointermove', i, t[k], 1));
  tracks.forEach((t, i) => ev('pointerup', i, t[t.length - 1], 0));
}, tracks);
const path = (x0: number, y0: number, x1: number, y1: number, n = 20): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
});

test('開いたときは、紙の幅が画面の幅に合っている', async ({ page }) => {
  const v = await view(page);
  expect(v.fit).toBe(true);
  // 倍率はタイルの画素に揃えるので、画面幅との差は 2px 未満
  expect(Math.abs(794 * v.s - v.W)).toBeLessThan(2);
  expect(Math.abs(v.x)).toBeLessThan(1);
});

test('fit の間、斜めに指を動かしても縦にだけ動き、横にはずれない', async ({ page }) => {
  const v0 = await view(page);
  await fingers(page, [path(500, 900, 300, 300)]);
  const v1 = await view(page);
  expect(v1.y).toBeLessThan(v0.y - 300);
  expect(v1.x).toBe(v0.x);
  expect(v1.s).toBe(v0.s);
  // 慣性で動き続けても横にはずれない
  await page.waitForTimeout(800);
  expect((await view(page)).x).toBe(v0.x);
});

test('fit の間、2 本指で動かしただけ(間隔がほぼ同じ)では倍率も横の位置も変わらない', async ({ page }) => {
  const v0 = await view(page);
  await fingers(page, [path(300, 900, 360, 500), path(500, 900, 565, 500)]);
  const v1 = await view(page);
  expect(v1.fit).toBe(true);
  expect(v1.s).toBe(v0.s);
  expect(v1.x).toBe(v0.x);
  expect(v1.y).toBeLessThan(v0.y - 300);
});

test('ピンチで倍率を変えると fit が外れ、自由に動かせる', async ({ page }) => {
  const v0 = await view(page);
  await fingers(page, [path(400, 600, 250, 600), path(450, 600, 600, 600)]);
  const v1 = await view(page);
  expect(v1.fit).toBe(false);
  expect(v1.s).toBeGreaterThan(v0.s * 2);
  await page.waitForTimeout(300);
  const v2 = await view(page);
  await fingers(page, [path(400, 600, 600, 400)]);
  expect((await view(page)).x).toBeGreaterThan(v2.x + 100);
});

test('開き直すと fit に戻り、縦の位置は前回の続き', async ({ page }) => {
  await page.evaluate(() => { const { r } = (window as any).tsugigami; r.fit = false; r.view = { s: 2.5, x: -300, y: -2500 }; r.clampView(); r.settle(); });
  const top = await page.evaluate(() => (window as any).tsugigami.r.toWorld(0, 0)[1]);
  // 表示位置の保存(描画の後 500ms。ヘッドレスの WebKit では描画が遅れることがあるので、決まった時間ではなく保存を待つ)
  await expect.poll(() => page.evaluate(async () => { const T = (window as any).tsugigami; return (await T.store.getMeta('view:' + T.doc.note.id))?.top; }), { timeout: 10000 })
    .toBeCloseTo(top, 0);
  await page.reload();
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  const v = await view(page);
  expect(v.fit).toBe(true);
  expect(Math.abs(794 * v.s - v.W)).toBeLessThan(2);
  const top2 = await page.evaluate(() => (window as any).tsugigami.r.toWorld(0, 0)[1]);
  expect(Math.abs(top2 - top)).toBeLessThan(2);
});
