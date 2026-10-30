import { expect, test } from '@playwright/test';

test('一度開けば、オフラインでも起動して前のノートが出る', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service Worker のオフライン再現は Chromium で確認する');
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // SW の管理下で一度開く
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.evaluate(() => {
    const st = document.querySelector('#stage')!, r = st.getBoundingClientRect();
    const ev = (n: string, x: number, y: number, b: number) => st.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: 3, pointerType: 'pen', clientX: r.left + x, clientY: r.top + y, pressure: 0.5, buttons: b }));
    ev('pointerdown', 100, 100, 1); ev('pointermove', 200, 120, 1); ev('pointerup', 200, 120, 0);
  });
  await page.waitForTimeout(300);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  expect(await page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(1);
});

test('長いノート(約 1 万本)でも開けて、スクロールの再描画が間に合う', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  // 30 ページに手書き風の線を敷き詰める
  await page.evaluate(() => {
    const { doc } = (window as any).tsugigami;
    const list = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let pg = 0; pg < 30; pg++) for (let row = 0; row < 30; row++) for (let k = 0; k < 11; k++) {
      const x0 = 40 + k * 66, y0 = pg * 1139 + 40 + row * 34, pts = [];
      for (let i = 0; i < 40; i++) pts.push(x0 + i * 1.4 + rnd() * 3, y0 + Math.sin(i / 3) * 8 + rnd() * 2, 0.35 + 0.15 * Math.sin(i / 7 + k));
      const P = Float32Array.from(pts);
      list.push({ id: crypto.randomUUID(), noteId: doc.note.id, kind: 'pen', color: '#1d2230', width: 2.2, pts: P, b: [x0 - 3, y0 - 12, x0 + 62, y0 + 12], z: doc.nextZ() });
    }
    doc.exec({ t: 'add', s: list });
  });
  const n = await page.evaluate(() => (window as any).tsugigami.doc.strokes.size);
  expect(n).toBe(9900);
  await page.waitForTimeout(1500); // 保存を待つ
  const t0 = Date.now();
  await page.reload();
  await page.waitForFunction(() => (window as any).tsugigami?.doc?.strokes.size === 9900);
  const openMs = Date.now() - t0;
  // スクロールしながら同期的に描画した時間(タイル焼き込み込み)
  const frames = await page.evaluate(() => {
    const { r } = (window as any).tsugigami;
    const out: number[] = [];
    for (let i = 0; i < 120; i++) {
      r.view.y -= 40;
      r.clampView();
      const t = performance.now();
      r.drawNow();
      out.push(performance.now() - t);
    }
    out.sort((a, b) => a - b);
    return { median: out[60], p95: out[114], max: out[119] };
  });
  info.annotations.push({ type: 'perf', description: `open ${openMs}ms, frame median ${frames.median.toFixed(1)}ms p95 ${frames.p95.toFixed(1)}ms max ${frames.max.toFixed(1)}ms` });
  console.log(info.project.name, 'open', openMs, 'ms; frame', JSON.stringify(frames));
  // ヘッドレスのブラウザはソフトウェア描画なので実機より遅い。桁違いの劣化だけを捕まえる
  expect(frames.p95).toBeLessThan(150);
});

test('画面を回転すると、幅に合わせて紙を表示し直す', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  const s0 = await page.evaluate(() => (window as any).tsugigami.r.view.s);
  await page.setViewportSize({ width: 1194, height: 834 });
  await expect.poll(() => page.evaluate(() => (window as any).tsugigami.r.view.s)).toBeGreaterThan(s0 * 1.3);
  const fits = await page.evaluate(() => { const { r } = (window as any).tsugigami; return Math.abs(r.view.x - (r.W - 794 * r.view.s) / 2) < 2; });
  expect(fits).toBe(true);
});

test('ステージの外で離しても、書きかけのまま固まらない', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.evaluate(() => {
    const st = document.querySelector('#stage')!, r = st.getBoundingClientRect();
    const o = (x: number, y: number, b: number) => ({ bubbles: true, pointerId: 9, pointerType: 'pen', clientX: r.left + x, clientY: r.top + y, pressure: 0.5, buttons: b });
    st.dispatchEvent(new PointerEvent('pointerdown', o(100, 100, 1)));
    st.dispatchEvent(new PointerEvent('pointermove', o(200, 150, 1)));
    document.querySelector('#bar')!.dispatchEvent(new PointerEvent('pointerup', o(200, -20, 0)));
  });
  expect(await page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(1);
  expect(await page.evaluate(() => (window as any).tsugigami.c.busy)).toBe(false);
});

test('右端のつまみで長いノートを移動でき、ページ番号が出る', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.evaluate(() => {
    const { doc } = (window as any).tsugigami;
    const list = [];
    for (let pg = 0; pg < 8; pg++) {
      const y = pg * 1139 + 100, P = Float32Array.from([100, y, 0.5, 300, y, 0.5]);
      list.push({ id: crypto.randomUUID(), noteId: doc.note.id, kind: 'pen', color: '#000', width: 2, pts: P, b: [98, y - 3, 302, y + 3], z: doc.nextZ() });
    }
    doc.exec({ t: 'add', s: list });
    (window as any).tsugigami.r.request();
  });
  const thumb = page.locator('#scroller');
  await expect(thumb).toBeVisible();
  const box = (await thumb.boundingBox())!;
  const y0 = await page.evaluate(() => (window as any).tsugigami.r.view.y);
  await page.evaluate(({ x, y }) => {
    const el = document.querySelector('#scroller')!;
    const o = (yy: number, b: number) => ({ bubbles: true, pointerId: 31, pointerType: 'touch', clientX: x, clientY: yy, buttons: b });
    el.dispatchEvent(new PointerEvent('pointerdown', o(y, 1)));
    el.dispatchEvent(new PointerEvent('pointermove', o(y + 400, 1)));
  }, { x: box.x + box.width / 2, y: box.y + 10 });
  await expect(page.locator('#pageLabel')).toContainText('/ 9 ページ');
  expect(await page.evaluate(() => (window as any).tsugigami.r.view.y)).toBeLessThan(y0 - 2000);
});

test('離したイベントを取りこぼしても、次にペンを置けば前の線が確定して書き続けられる', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.evaluate(() => {
    const st = document.querySelector('#stage')!, r = st.getBoundingClientRect();
    const ev = (n: string, id: number, x: number, y: number, b: number) => st.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: id, pointerType: 'pen', clientX: r.left + x, clientY: r.top + y, pressure: 0.5, buttons: b }));
    ev('pointerdown', 40, 100, 100, 1); ev('pointermove', 40, 200, 100, 1); // up が来ない
    ev('pointerdown', 41, 100, 200, 1); ev('pointermove', 41, 200, 200, 1); ev('pointerup', 41, 200, 200, 0);
  });
  expect(await page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(2);
});

// 本物の 2 本指タップは 41〜75ms 触れている(raw/2026-10-30_lab_taps)。0ms のタップは手の触れとみなされる
const twoFingerTap = (page: import('@playwright/test').Page) => page.evaluate(async () => {
  const st = document.querySelector('#stage')!, r = st.getBoundingClientRect();
  const ev = (n: string, id: number, x: number, b: number) => st.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + 500, buttons: b }));
  ev('pointerdown', 51, 300, 1); ev('pointerdown', 52, 400, 1);
  await new Promise(f => setTimeout(f, 60));
  ev('pointerup', 51, 300, 0); ev('pointerup', 52, 400, 0);
});
const penLine = (page: import('@playwright/test').Page, y: number) => page.evaluate(y => {
  const st = document.querySelector('#stage')!, r = st.getBoundingClientRect();
  const ev = (n: string, x: number, b: number) => st.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: 60, pointerType: 'pen', clientX: r.left + x, clientY: r.top + y, pressure: 0.5, buttons: b }));
  ev('pointerdown', 100, 1); ev('pointermove', 250, 1); ev('pointerup', 250, 0);
}, y);

test('2 本指タップで取り消す。直後にペンが触れたら手のひらとみなして取り消さない', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await penLine(page, 100);
  await page.waitForTimeout(600); // 手のひら判定の時間を過ぎてから
  await twoFingerTap(page);
  await expect.poll(() => page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(0);
  await penLine(page, 150);
  await page.waitForTimeout(600);
  await twoFingerTap(page);
  await penLine(page, 200); // すぐにペン
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(2);
});

test('手をついたときの小さな揺れでは紙が動かず、直後にペンが来たら動いた分を戻す', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  const r = await page.evaluate(() => {
    const st = document.querySelector('#stage')!, b = st.getBoundingClientRect(), T = (window as any).tsugigami;
    const ev = (n: string, id: number, type: string, x: number, y: number, buttons: number) =>
      st.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: id, pointerType: type, clientX: b.left + x, clientY: b.top + y, buttons, pressure: type === 'pen' ? 0.5 : 0 }));
    const y0 = T.r.view.y;
    // 手のひら: 数 px ふらつくだけ
    ev('pointerdown', 31, 'touch', 500, 700, 1);
    for (const d of [2, -3, 4, 1, -2]) ev('pointermove', 31, 'touch', 500 + d, 700 + d, 1);
    const still = T.r.view.y;
    // 手のひらがずれて紙が動いた直後にペンが着地
    for (let i = 1; i <= 4; i++) ev('pointermove', 31, 'touch', 500, 700 - i * 15, 1);
    const dragged = T.r.view.y;
    ev('pointerdown', 32, 'pen', 300, 300, 1);
    const reverted = T.r.view.y;
    ev('pointermove', 32, 'pen', 360, 300, 1);
    ev('pointerup', 32, 'pen', 360, 300, 0);
    ev('pointerup', 31, 'touch', 500, 640, 0);
    return { y0, still, dragged, reverted };
  });
  expect(r.still).toBe(r.y0);
  expect(r.dragged).not.toBe(r.y0);
  expect(r.reverted).toBe(r.y0);
  expect(await page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(1);
});

test('マーカーは乗算で重なる(白地ではその色、別の色との重なりは掛け合わせ)', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.click('#paper'); // 方眼を消して無地で測る
  await page.click('[data-tool="marker"]');
  expect(await page.evaluate(() => (window as any).tsugigami.c.marker.width)).toBe(35);
  const draw = (color: string, x0: number, y0: number, x1: number, y1: number) => page.evaluate(({ color, x0, y0, x1, y1 }) => {
    const T = (window as any).tsugigami;
    T.c.marker.color = color;
    const st = document.querySelector('#stage')!, b = st.getBoundingClientRect();
    const ev = (n: string, x: number, y: number, buttons: number) =>
      st.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: 41, pointerType: 'pen', clientX: b.left + x, clientY: b.top + y, buttons, pressure: 0.5 }));
    ev('pointerdown', x0, y0, 1);
    for (let i = 1; i <= 10; i++) ev('pointermove', x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10, 1);
    ev('pointerup', x1, y1, 0);
  }, { color, x0, y0, x1, y1 });
  await draw('#9ec2fa', 400, 300, 400, 600);
  await draw('#edaea6', 250, 450, 550, 450);
  await page.waitForTimeout(300);
  const px = await page.evaluate(() => {
    const T = (window as any).tsugigami, c = T.r.base as HTMLCanvasElement, d = T.r.dpr;
    const at = (x: number, y: number) => Array.from(c.getContext('2d')!.getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data.slice(0, 3));
    return { blue: at(400, 350), red: at(300, 450), both: at(400, 450) };
  });
  const paper = [0xfd, 0xfc, 0xf8], mul = (a: number[], b: number[]) => a.map((v, i) => (v * b[i]) / 255);
  const near = (got: number[], want: number[]) => got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThan(4));
  near(px.blue, mul([0x9e, 0xc2, 0xfa], paper));
  near(px.red, mul([0xed, 0xae, 0xa6], paper));
  near(px.both, mul(mul([0x9e, 0xc2, 0xfa], [0xed, 0xae, 0xa6]), paper));
});
