// iPad で記録した本物のタッチ(raw/2026-10-30_lab_palm-rest/)を同じ間隔で流し込み、紙が動くべきか動かないべきかを確かめる。
// 規則は想像ではなくこの記録から決める(nishio、2026-10-30)。
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Ev = { t: number; type: string; pt: string; id: number; x: number; y: number; p: number; buttons: number; co?: number[][] };
const load = (name: string, dir = 'palm-rest'): Ev[] => JSON.parse(readFileSync(`raw/2026-10-30_lab_${dir}/${name}-events.json`, 'utf8'));

/** ペンで短い横線を n 本引く */
async function penLines(page: Page, n: number) {
  await page.evaluate(n => {
    const st = document.querySelector('#stage')!, b = st.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const y = 150 + i * 30;
      const ev = (name: string, x: number, bt: number) => st.dispatchEvent(new PointerEvent(name, { bubbles: true, pointerId: 9, pointerType: 'pen', clientX: b.left + x, clientY: b.top + y, buttons: bt, pressure: bt ? 0.5 : 0 }));
      ev('pointerdown', 100, 1); for (let x = 120; x <= 300; x += 20) ev('pointermove', x, 1); ev('pointerup', 300, 0);
    }
  }, n);
  await page.waitForTimeout(600);
}

/** 記録を実時間で再生する(pointerId は小さい番号に詰め替える) */
async function replay(page: Page, events: Ev[], speed = 1) {
  return page.evaluate(async ({ events, speed }) => {
    const st = document.querySelector('#stage')!, b = st.getBoundingClientRect(), T = (window as any).tsugigami;
    const ids = new Map<number, number>();
    const idOf = (id: number) => { if (!ids.has(id)) ids.set(id, 100 + ids.size); return ids.get(id)!; };
    const before = { ...T.r.view, strokes: T.doc.strokes.size };
    const t0 = events[0].t, start = performance.now();
    for (const e of events) {
      const due = start + (e.t - t0) / speed;
      const wait = due - performance.now();
      if (wait > 1) await new Promise(f => setTimeout(f, wait));
      st.dispatchEvent(new PointerEvent(e.type, {
        bubbles: true, cancelable: true, pointerId: idOf(e.id), pointerType: e.pt, isPrimary: false,
        clientX: b.left + e.x, clientY: b.top + e.y, buttons: e.buttons, pressure: e.p,
      }));
    }
    await new Promise(f => setTimeout(f, 400)); // タップの猶予(250ms)を過ぎるまで
    const after = { ...T.r.view, strokes: T.doc.strokes.size, palm: T.c.stats.palm };
    return { before, after };
  }, { events, speed });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.evaluate(() => { const T = (window as any).tsugigami; T.r.view = { s: 1, x: 115, y: 0 }; T.r.clampView(); T.r.settle(); });
});

test('手だけを置いて転がしても(rest-only、158 タッチ)、紙は動かず取り消しも起きない', async ({ page }) => {
  await penLines(page, 1); // 取り消されうる線を 1 本
  const r = await replay(page, load('rest-only'));
  console.log(test.info().title.slice(0, 30), JSON.stringify(r));
  expect(r.after.s).toBe(r.before.s);
  expect(r.after.x).toBe(r.before.x);
  expect(r.after.y).toBe(r.before.y);
  // 記録の先頭(0.00 秒)の 2 点・17ms の触れが 2 本指タップに見えないこと(TAP_MIN_MS)
  expect(r.after.strokes).toBe(1);
});

test('わざとのピンチ(pinch)では倍率が変わる', async ({ page }) => {
  const r = await replay(page, load('pinch'));
  console.log(test.info().title.slice(0, 30), JSON.stringify(r));
  expect(Math.abs(r.after.s - r.before.s)).toBeGreaterThan(0.2);
});

test('わざとのスクロール(scroll)では紙が動く', async ({ page }) => {
  const r = await replay(page, load('scroll'));
  console.log(test.info().title.slice(0, 30), JSON.stringify(r));
  expect(Math.abs(r.after.y - r.before.y) + Math.abs(r.after.x - r.before.x)).toBeGreaterThan(100);
});

test('議事録を書いている間(minutes、ペン 260 本)の数少ないタッチで、紙は動かず線も消えない', async ({ page }) => {
  test.setTimeout(240000);
  const r = await replay(page, load('minutes'), 1);
  console.log(test.info().title.slice(0, 30), JSON.stringify(r));
  expect(r.after.strokes).toBe(260);
  expect(r.after.s).toBe(r.before.s);
  expect(r.after.x).toBe(r.before.x);
  expect(r.after.y).toBe(r.before.y);
});

test('わざとの 2 本指タップ(tap2、15 回)で取り消しが働く', async ({ page }) => {
  await penLines(page, 3);
  const r = await replay(page, load('tap2', 'taps'));
  console.log('tap2', JSON.stringify(r));
  expect(r.after.strokes).toBe(0);
});

test('手を置いてすぐ離す(hand-touch)では、紙は動かず線も消えない', async ({ page }) => {
  await penLines(page, 1);
  const r = await replay(page, load('hand-touch', 'taps'));
  console.log('hand-touch', JSON.stringify(r));
  expect(r.after.strokes).toBe(1);
  expect(r.after.s).toBe(r.before.s); expect(r.after.x).toBe(r.before.x); expect(r.after.y).toBe(r.before.y);
});

test('手を置いて線を書いて離す(hand-write、5 本)で、線は 5 本残り紙は動かない', async ({ page }) => {
  const r = await replay(page, load('hand-write', 'taps'));
  console.log('hand-write', JSON.stringify(r));
  expect(r.after.strokes).toBe(5);
  expect(r.after.s).toBe(r.before.s); expect(r.after.x).toBe(r.before.x); expect(r.after.y).toBe(r.before.y);
});
