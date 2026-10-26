import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

type Pt = [number, number];

/** #stage に合成の PointerEvent を流す(座標はステージ内) */
async function stroke(page: Page, pts: Pt[], type: 'pen' | 'touch' = 'pen', id = 7) {
  await page.evaluate(({ pts, type, id }) => {
    const st = document.querySelector('#stage')!, r = st.getBoundingClientRect();
    const ev = (name: string, [x, y]: [number, number], buttons: number) =>
      st.dispatchEvent(new PointerEvent(name, { bubbles: true, pointerId: id, pointerType: type, isPrimary: true, clientX: r.left + x, clientY: r.top + y, pressure: buttons ? 0.5 : 0, buttons }));
    ev('pointerdown', pts[0], 1);
    for (const p of pts.slice(1)) ev('pointermove', p, 1);
    ev('pointerup', pts[pts.length - 1], 0);
  }, { pts, type, id });
}

const line = (x0: number, y0: number, x1: number, y1: number, n = 12): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

const count = (page: Page) => page.evaluate(() => (window as any).tsugigami.doc.strokes.size as number);
const strokesInfo = (page: Page) => page.evaluate(() => [...(window as any).tsugigami.doc.strokes.values()].map((s: any) => ({ kind: s.kind, color: s.color, b: s.b })));

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
});

test('書いた線が保存され、再読み込みしても残る', async ({ page }) => {
  await stroke(page, line(100, 200, 400, 260));
  await stroke(page, line(100, 300, 400, 300));
  expect(await count(page)).toBe(2);
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  expect(await count(page)).toBe(2);
});

test('消しゴムで線ごと消え、取り消しで戻る', async ({ page }) => {
  await stroke(page, line(100, 200, 400, 200));
  await page.click('[data-tool="eraser"]');
  await stroke(page, line(250, 150, 250, 250));
  expect(await count(page)).toBe(0);
  await page.click('#undo');
  expect(await count(page)).toBe(1);
  await page.click('#redo');
  expect(await count(page)).toBe(0);
});

test('マーカーは別の種類として保存される', async ({ page }) => {
  await page.click('[data-tool="marker"]');
  await stroke(page, line(100, 400, 500, 400));
  expect((await strokesInfo(page))[0].kind).toBe('marker');
});

test('投げ縄で選んで動かし、コピーして貼り付けられる', async ({ page }) => {
  await stroke(page, line(200, 300, 300, 320));
  const before = (await strokesInfo(page))[0].b;
  await page.click('[data-tool="lasso"]');
  await stroke(page, [[150, 250], [350, 250], [350, 380], [150, 380], [150, 250]]);
  await expect(page.locator('#selMenu')).toBeVisible();
  await stroke(page, line(250, 310, 250, 510)); // 枠の中を掴んで下へ 200px
  const after = (await strokesInfo(page))[0].b;
  expect(after[1] - before[1]).toBeGreaterThan(150);
  await page.click('#selMenu [data-act="copy"]');
  await expect(page.locator('#paste')).toBeVisible();
  await page.click('#paste');
  expect(await count(page)).toBe(2);
  await page.click('#undo'); // 貼り付けの取り消し
  expect(await count(page)).toBe(1);
});

test('選択中に色を選ぶと線の色が変わる', async ({ page }) => {
  await stroke(page, line(200, 300, 300, 320));
  await page.click('[data-tool="lasso"]');
  await stroke(page, [[150, 250], [350, 250], [350, 380], [150, 380]]);
  await page.click('#swatches button[aria-label="赤"]');
  expect((await strokesInfo(page))[0].color).toBe('#d0352b');
});

test('ペンの直後のタッチは手のひらとして無視し、指 1 本ではスクロールする', async ({ page }) => {
  const y0 = await page.evaluate(() => (window as any).tsugigami.r.view.y);
  await stroke(page, line(100, 200, 300, 200));
  await stroke(page, line(400, 600, 400, 300), 'touch', 21);
  expect(await page.evaluate(() => (window as any).tsugigami.r.view.y)).toBe(y0);
  await page.waitForTimeout(600);
  await stroke(page, line(400, 600, 400, 300), 'touch', 22);
  expect(await page.evaluate(() => (window as any).tsugigami.r.view.y)).toBeLessThan(y0 - 100);
  expect(await count(page)).toBe(1);
});

test('紙を右へ継ぎ足し、取り消せる', async ({ page }) => {
  await page.locator('.page-btn', { hasText: '+' }).first().click();
  expect(await page.evaluate(() => (window as any).tsugigami.doc.note.pages[0].w)).toBe(2);
  await page.click('#undo');
  expect(await page.evaluate(() => (window as any).tsugigami.doc.note.pages[0].w)).toBe(1);
});

test('ノートを作り、名前を変え、ゴミ箱から戻せる', async ({ page }) => {
  await stroke(page, line(100, 200, 300, 200));
  await page.click('#menuBtn');
  await page.click('#newNote');
  await expect.poll(() => count(page)).toBe(0);
  await page.click('#title');
  await page.fill('#titleInput', '会議メモ');
  await page.press('#titleInput', 'Enter');
  await expect(page.locator('#title')).toHaveText('会議メモ');
  await page.click('#menuBtn');
  await expect(page.locator('#noteList li')).toHaveCount(2);
  await page.locator('#noteList li', { hasText: '会議メモ' }).getByText('ゴミ箱へ').click();
  await expect(page.locator('#noteList li')).toHaveCount(1);
  await expect.poll(() => count(page)).toBe(1); // 残ったノートが開く
  await page.locator('#trash summary').click();
  await page.locator('#trashList li').getByText('戻す').click();
  await expect(page.locator('#noteList li')).toHaveCount(2);
});

test('バックアップを書き出せる', async ({ page }) => {
  await stroke(page, line(100, 200, 300, 200));
  await page.click('#menuBtn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  const path = await dl.path();
  const data = JSON.parse(readFileSync(path, 'utf8'));
  expect(data.format).toBe('tsugigami-backup');
  expect(data.strokes.length).toBe(1);
});

test('見た目', async ({ page }, info) => {
  await stroke(page, line(80, 120, 420, 140, 30));
  await stroke(page, [[100, 200], [140, 180], [180, 230], [220, 190], [260, 240], [300, 200]]);
  await page.click('[data-tool="marker"]');
  await stroke(page, line(80, 130, 300, 130));
  await page.click('[data-tool="pen"]');
  await page.click('#swatches button[aria-label="赤"]');
  await stroke(page, line(500, 300, 700, 500));
  await page.click('[data-tool="lasso"]');
  await stroke(page, [[480, 280], [720, 280], [720, 520], [480, 520]]);
  await page.screenshot({ path: `test-results/look-${info.project.name}.png` });
});
