import { expect, test } from '@playwright/test';

// 既存のノートや画像は使わず、同じ合成点列をイベントのまとまりだけ変えて描く。
for (const shape of ['直線', '曲線', '角']) {
test(`${shape}の縁は入力イベントの分割数で濃くならない`, async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  const result = await page.evaluate(async shape => {
    const { r, c } = (window as any).tsugigami;
    const stage = document.querySelector('#stage')!, rect = stage.getBoundingClientRect();
    r.fit = false; r.view = { s: 1, x: 0, y: 0 }; r.rs = 1; r.drawNow(true);
    const pts = Array.from({ length: 1201 }, (_, i) => shape === '角'
      ? [100.2 + Math.min(i, 600) * 0.5, 220.2 + Math.max(0, i - 600) * 0.2]
      : [100.2 + i * 0.5, 220.2 + (shape === '曲線' ? 20 * Math.sin(i / 100) : i * 0.015)]);
    const frame = () => new Promise<void>(f => requestAnimationFrame(() => f()));
    async function render(batch: number, pause: boolean) {
      const ev = (type: string, p: number[], buttons: number) => new PointerEvent(type, {
        bubbles: true, pointerId: 27, pointerType: 'pen', buttons, pressure: buttons ? 0.5 : 0,
        clientX: rect.left + p[0], clientY: rect.top + p[1],
      });
      stage.dispatchEvent(ev('pointerdown', pts[0], 1));
      for (let i = 1; i < pts.length; i += batch) {
        const samples = pts.slice(i, i + batch).map(p => ev('pointermove', p, 1));
        const event = ev('pointermove', pts[Math.min(i + batch, pts.length) - 1], 1);
        Object.defineProperty(event, 'getCoalescedEvents', { value: () => samples });
        stage.dispatchEvent(event);
        if (pause && i % 100 === 1) await frame();
      }
      await frame();
      const canvas = document.createElement('canvas'); canvas.width = r.live.width; canvas.height = r.live.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(r.live, 0, 0); ctx.drawImage(r.wet, 0, 0);
      const data = ctx.getImageData(190, 350, 1240, 400).data;
      stage.dispatchEvent(ev('pointerup', pts[pts.length - 1], 0));
      await frame();
      return data;
    }
    const one = await render(pts.length, false), split = await render(1, true);
    let changed = 0, maxAlphaDiff = 0, alphaA = 0, alphaB = 0;
    for (let i = 3; i < one.length; i += 4) {
      const d = Math.abs(one[i] - split[i]);
      if (d) changed++;
      maxAlphaDiff = Math.max(maxAlphaDiff, d); alphaA += one[i]; alphaB += split[i];
    }
    return { changed, maxAlphaDiff, alphaA, alphaB };
  }, shape);
  console.log('ink event grouping', shape, result);
  expect(result.alphaA).toBeGreaterThan(10000); // 空白どうしの比較で通さない
  expect(result.maxAlphaDiff).toBeLessThanOrEqual(1);
  expect(result.changed).toBeLessThan(50);
});
}

test('フレーム待ちでも線が途切れず、離した後にライブ層が戻らない', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  const result = await page.evaluate(async () => {
    const { r, doc } = (window as any).tsugigami, stage = document.querySelector('#stage')!;
    const rect = stage.getBoundingClientRect();
    r.fit = false; r.view = { s: 1, x: 0, y: 0 }; r.rs = 1; r.drawNow(true);
    const ev = (type: string, x: number, buttons: number) => stage.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 30, pointerType: 'pen', clientX: rect.left + x,
      clientY: rect.top + 250, buttons, pressure: buttons ? 0.5 : 0,
    }));
    ev('pointerdown', 100, 1);
    for (let x = 101; x <= 500; x++) ev('pointermove', x, 1);
    // rAF がまだ走っていない同じイベントループ内で、wet が線全体をつないでいるか。
    const ctx = r.wctx, px = ctx.getImageData(210, 500, 770, 1).data as Uint8ClampedArray;
    const gaps = Array.from({ length: 770 }, (_, i) => px[i * 4 + 3]).filter(a => a < 200).length;
    ev('pointerup', 500, 0);
    for (let i = 0; i < 2; i++) await new Promise<void>(f => requestAnimationFrame(() => f()));
    const alpha = (c: CanvasRenderingContext2D) => {
      const d = c.getImageData(190, 490, 830, 20).data;
      let sum = 0; for (let i = 3; i < d.length; i += 4) sum += d[i]; return sum;
    };
    return { gaps, live: alpha(r.lctx), wet: alpha(r.wctx), points: [...doc.strokes.values()][0].pts.length / 3 };
  });
  expect(result.gaps).toBe(0);
  expect(result.live).toBe(0); expect(result.wet).toBe(0);
  expect(result.points).toBe(401);
});

test('一万点の線でも入力をまとめて描き、イベント処理を重くしない', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  const result = await page.evaluate(async () => {
    const { r, doc } = (window as any).tsugigami, stage = document.querySelector('#stage')!;
    const rect = stage.getBoundingClientRect();
    r.fit = false; r.view = { s: 1, x: 0, y: 0 }; r.rs = 1; r.drawNow(true);
    const pts = Array.from({ length: 10001 }, (_, i) => [100 + (i % 1000) * 0.5, 200 + Math.floor(i / 1000) * 20 + 3 * Math.sin(i / 30)]);
    const paint: number[] = [], move: number[] = [], frames: number[] = [];
    const stroke = r.lctx.stroke.bind(r.lctx);
    r.lctx.stroke = (...args: any[]) => { const t = performance.now(); stroke(...args); paint.push(performance.now() - t); };
    const event = (type: string, p: number[], buttons: number) => new PointerEvent(type, {
      bubbles: true, pointerId: 31, pointerType: 'pen', buttons, pressure: buttons ? 0.5 : 0,
      clientX: rect.left + p[0], clientY: rect.top + p[1],
    });
    stage.dispatchEvent(event('pointerdown', pts[0], 1));
    for (let i = 1; i < pts.length; i += 50) {
      for (let j = i; j < Math.min(pts.length, i + 50); j++) {
        const e = event('pointermove', pts[j], 1), t = performance.now();
        stage.dispatchEvent(e); move.push(performance.now() - t);
      }
      const t = performance.now(); await new Promise<void>(f => requestAnimationFrame(() => f()));
      frames.push(performance.now() - t);
    }
    const calls = paint.length;
    r.lctx.stroke = stroke;
    stage.dispatchEvent(event('pointerup', pts[pts.length - 1], 0));
    const p95 = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
    return { calls, moveP95: p95(move), paintP95: p95(paint), frameP95: p95(frames), points: [...doc.strokes.values()][0].pts.length / 3 };
  });
  console.log('ink performance', result);
  expect(result.points).toBe(10001);
  expect(result.calls).toBeLessThan(250);
  expect(result.moveP95).toBeLessThan(12);
  expect(result.paintP95).toBeLessThan(25);
  expect(result.frameP95).toBeLessThan(100);
});
