import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('記録を選んだときだけ接触の特徴を保存し、内容を含めず書き出せる', async ({ page }) => {
  await page.goto('./'); await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.click('#menuBtn'); await page.getByText('書き味の計測', { exact: true }).click();
  await expect(page.locator('#touchRecord')).not.toBeChecked();
  await page.check('#touchRecord');
  await page.evaluate(() => {
    (document.querySelector('#scrim') as HTMLElement).click();
    const el = document.querySelector('#stage')!, r = el.getBoundingClientRect();
    const ev = (type: string, id: number, pointerType: string, x: number, y: number, buttons: number) =>
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType, clientX: r.left + x, clientY: r.top + y, width: 8, height: 12, pressure: 0.5, buttons }));
    ev('pointerdown', 1, 'pen', 100, 200, 1); ev('pointermove', 1, 'pen', 300, 200, 1);
    ev('pointerdown', 2, 'touch', 400, 500, 1); ev('pointercancel', 2, 'touch', 400, 500, 0);
    ev('pointerup', 1, 'pen', 300, 200, 0);
  });
  await expect.poll(() => page.evaluate(async () => (await (window as any).tsugigami.store.getMeta('touch-stats-v1'))?.report.samples.length)).toBe(1);
  await page.reload(); await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.click('#menuBtn'); await page.getByText('書き味の計測', { exact: true }).click();
  await expect(page.locator('#touchRecord')).toBeChecked();
  await expect(page.locator('#touchRecordInfo')).toContainText('接触 1 回');
  const waiting = page.waitForEvent('download'); await page.click('#touchExport');
  const path = await (await waiting).path(); const data = JSON.parse(readFileSync(path!, 'utf8'));
  expect(data.format).toBe('tsugigami-touch-stats'); expect(data.total).toBe(1);
  expect(data.samples[0]).toMatchObject({ x: 400, y: 500, penActive: true, cancelled: true, decision: 'os-cancelled', width: 8, height: 12 });
  expect(JSON.stringify(data)).not.toMatch(/"(pts|strokes|notes|title|token)"/);
  await page.uncheck('#touchRecord'); await page.click('#touchClear');
  await expect(page.locator('#touchRecordInfo')).toContainText('接触 0 回');
  await expect(page.locator('#touchExport')).toBeDisabled();
});
