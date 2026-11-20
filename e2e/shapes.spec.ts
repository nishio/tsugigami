import { expect, test, type Page } from '@playwright/test';

const send = (page: Page, type: string, id: number, pointerType: string, x: number, y: number, buttons = 1) =>
  page.evaluate(e => {
    const el = document.querySelector('#stage')!, b = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(e.type, { bubbles: true, pointerId: e.id, pointerType: e.pointerType,
      clientX: b.left + e.x, clientY: b.top + e.y, buttons: e.buttons, pressure: e.buttons ? 0.5 : 0 }));
  }, { type, id, pointerType, x, y, buttons });

async function begin(page: Page, circle = false) {
  await page.evaluate(circle => {
    const el = document.querySelector('#stage')!, b = el.getBoundingClientRect();
    const ev = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 81, pointerType: 'pen', clientX: b.left + x, clientY: b.top + y, pressure: 0.5, buttons: 1,
    }));
    for (let i = 0; i <= 80; i++) {
      const x = circle ? 300 + 60 * Math.cos(i * 2 * Math.PI / 80) : 100 + i * 3;
      const y = circle ? 400 + 60 * Math.sin(i * 2 * Math.PI / 80) : 250 + i * 0.1 + 0.2 * Math.sin(i);
      ev(i ? 'pointermove' : 'pointerdown', x, y);
    }
  }, circle);
}
async function tap(page: Page) {
  await send(page, 'pointerdown', 82, 'touch', 600, 800);
  await page.waitForTimeout(65);
  await send(page, 'pointerup', 82, 'touch', 600, 800, 0);
}
const info = (page: Page) => page.evaluate(() => [...(window as any).tsugigami.doc.strokes.values()].map((s: any) => ({ pts: Array.from(s.pts) as number[], b: s.b })));
test.beforeEach(async ({ page }) => {
  await page.goto('./'); await page.waitForFunction(() => (window as any).tsugigami?.doc);
});

test('Pencil を接地したままタップすると、軌跡を直線にし水平へスナップする', async ({ page }) => {
  await begin(page); await tap(page); await expect(page.locator('#toast')).toHaveText('直線');
  await send(page, 'pointermove', 81, 'pen', 450, 258);
  await send(page, 'pointerup', 81, 'pen', 450, 258, 0);
  const [s] = await info(page); expect(s.pts).toHaveLength(6); expect(s.pts[1]).toBe(s.pts[4]);
  await page.click('#undo'); expect(await info(page)).toHaveLength(0);
  await page.click('#redo'); expect((await info(page))[0].pts).toEqual(s.pts);
});

test('円の軌跡をタップすると円にし、その後のペン先で半径を変えられる', async ({ page }) => {
  await begin(page, true); await tap(page); await expect(page.locator('#toast')).toHaveText('円');
  await send(page, 'pointermove', 81, 'pen', 400, 400);
  await send(page, 'pointerup', 81, 'pen', 400, 400, 0);
  const [s] = await info(page);
  expect(s.pts.length).toBeGreaterThan(90); expect(s.pts.slice(0, 3)).toEqual(s.pts.slice(-3));
  expect(Math.abs((s.b[2] - s.b[0]) - (s.b[3] - s.b[1]))).toBeLessThan(0.1);
});

test('もう一度タップすると保持していた手書きの軌跡へ戻せる', async ({ page }) => {
  await begin(page); await tap(page); await expect(page.locator('#toast')).toHaveText('直線');
  await tap(page); await expect(page.locator('#toast')).toHaveText('手書き');
  await send(page, 'pointerup', 81, 'pen', 340, 258, 0);
  expect((await info(page))[0].pts.length).toBeGreaterThan(6);
});

for (const kind of ['cancel', 'multiple', 'short', 'drag', 'held', 'pen-lift']) {
  test(`手の触れを図形にしない: ${kind}`, async ({ page }) => {
    await begin(page);
    await send(page, 'pointerdown', 82, 'touch', 600, 800);
    if (kind === 'multiple') await send(page, 'pointerdown', 83, 'touch', 650, 850);
    if (kind === 'drag') await send(page, 'pointermove', 82, 'touch', 620, 820);
    await page.waitForTimeout(kind === 'held' ? 280 : kind === 'short' ? 1 : 65);
    await send(page, kind === 'cancel' ? 'pointercancel' : 'pointerup', 82, 'touch', 600, 800, 0);
    if (kind === 'multiple') await send(page, 'pointerup', 83, 'touch', 650, 850, 0);
    if (kind === 'pen-lift') await send(page, 'pointerup', 81, 'pen', 340, 258, 0);
    await page.waitForTimeout(380);
    if (kind !== 'pen-lift') await send(page, 'pointerup', 81, 'pen', 340, 258, 0);
    expect((await info(page))[0].pts.length).toBeGreaterThan(6);
  });
}

test('Pencil より先に触れていた手と、タップ直後に続く接触は図形にしない', async ({ page }) => {
  await send(page, 'pointerdown', 84, 'touch', 600, 800);
  await begin(page); await tap(page); await page.waitForTimeout(350);
  await send(page, 'pointerup', 84, 'touch', 600, 800, 0);
  // 最初の触れが残っていた間のタップは無効。その後、単独タップの候補も次の接触で取り消す。
  await page.waitForTimeout(350); await tap(page);
  await send(page, 'pointerdown', 85, 'touch', 650, 850);
  await send(page, 'pointercancel', 85, 'touch', 650, 850, 0);
  await page.waitForTimeout(380);
  await send(page, 'pointerup', 81, 'pen', 340, 258, 0);
  expect((await info(page))[0].pts.length).toBeGreaterThan(6);
});
