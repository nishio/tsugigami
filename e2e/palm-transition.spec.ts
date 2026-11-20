import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.evaluate(() => (window as any).tsugigami.r.fitView(300));
});

test('fit 中の横方向の触れで、縦の小さな揺れがスクロールにならない', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { r } = (window as any).tsugigami, el = document.querySelector('#stage')!, b = el.getBoundingClientRect();
    const ev = (type: string, x: number, y: number, buttons = 1) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 71, pointerType: 'touch', clientX: b.left + x, clientY: b.top + y, buttons,
    }));
    const before = { ...r.view };
    ev('pointerdown', 500, 700); ev('pointermove', 530, 700); ev('pointermove', 530, 698);
    ev('pointerup', 530, 698, 0);
    return { before, after: { ...r.view } };
  });
  expect(result.after).toEqual(result.before);
});

test('2 本から 1 本に減った直後の小さな揺れでは紙が動かない', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { r } = (window as any).tsugigami, el = document.querySelector('#stage')!, b = el.getBoundingClientRect();
    const ev = (type: string, id: number, x: number, y: number, buttons = 1) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: id, pointerType: 'touch', clientX: b.left + x, clientY: b.top + y, buttons,
    }));
    ev('pointerdown', 72, 300, 700); ev('pointerdown', 73, 500, 700);
    for (const y of [670, 640, 610]) { ev('pointermove', 72, 300, y); ev('pointermove', 73, 500, y); }
    ev('pointerup', 73, 500, 610, 0);
    const before = { ...r.view };
    ev('pointermove', 72, 300, 608); ev('pointerup', 72, 300, 608, 0);
    return { before, after: { ...r.view } };
  });
  expect(result.after).toEqual(result.before);
});
