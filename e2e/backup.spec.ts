// 書いたものが消えないこと: 手元の保存の再試行と、GitHub への自動バックアップ・復元。
// GitHub はメモリ上の偽物(tests/fakeGitHub.ts)に差し替える。
import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { FakeGitHub } from '../tests/fakeGitHub';

test.use({ serviceWorkers: 'block' });

async function routeGitHub(ctx: BrowserContext, gh: FakeGitHub) {
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request();
    const res = await gh.fetch(req.url(), { method: req.method(), headers: await req.allHeaders(), body: req.postData() ?? undefined });
    await route.fulfill({ status: res.status, body: await res.text(), headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  });
}

async function open(page: Page) {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
}

async function penLine(page: Page, y: number) {
  await page.evaluate(y => {
    const st = document.querySelector('#stage')!, r = st.getBoundingClientRect();
    const ev = (n: string, x: number, b: number) =>
      st.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: 5, pointerType: 'pen', clientX: r.left + x, clientY: r.top + y, buttons: b, pressure: b ? 0.5 : 0 }));
    ev('pointerdown', 100, 1);
    for (let x = 120; x <= 300; x += 20) ev('pointermove', x, 1);
    ev('pointerup', 300, 0);
  }, y);
}

async function configure(page: Page, gh: FakeGitHub) {
  await page.click('#menuBtn');
  await page.fill('#ghRepo', gh.repo);
  await page.fill('#ghToken', gh.token);
  await page.click('#ghSave');
  await expect(page.locator('#toast')).toHaveText('GitHub へ送りました');
}

test('GitHub へ送り、別の端末(空の保存領域)で読み込める', async ({ browser }) => {
  const gh = new FakeGitHub();
  const a = await browser.newContext();
  await routeGitHub(a, gh);
  const pa = await a.newPage();
  await open(pa);
  await configure(pa, gh);
  await pa.click('#scrim');
  await penLine(pa, 200);
  await penLine(pa, 260);
  const id = await pa.evaluate(() => (window as any).tsugigami.doc.note.id as string);
  await pa.evaluate(() => (window as any).tsugigami.auto.run());
  const page = JSON.parse(gh.files().get(`notes/${id}/p0001.json`)!);
  expect(page.strokes).toHaveLength(2);
  expect([...gh.commits.values()].at(-1)!.message).toMatch(/^tsugigami: 1 冊を更新/);

  // 別の端末: 空の状態から同じ repo を設定する。手元に無いノートを消さずに、読み込みで戻る
  const b = await browser.newContext();
  await routeGitHub(b, gh);
  const pb = await b.newPage();
  await open(pb);
  await configure(pb, gh);
  expect(gh.files().has(`notes/${id}/p0001.json`)).toBe(true);
  await pb.click('#ghRestore');
  await expect(pb.locator('#toast')).toHaveText('1 冊のノートを GitHub から読み込みました');
  const n = await pb.evaluate(async id => (await (window as any).tsugigami.store.strokesOf(id)).length, id);
  expect(n).toBe(2);
  await a.close(); await b.close();
});

test('書いてしばらく手を止めると、自動で送る', async ({ browser }) => {
  const gh = new FakeGitHub();
  const ctx = await browser.newContext();
  await routeGitHub(ctx, gh);
  const page = await ctx.newPage();
  await page.clock.install();
  await open(page);
  await configure(page, gh);
  await page.click('#scrim');
  const before = gh.commits.size;
  await penLine(page, 300);
  await page.clock.runFor(25_000);
  await expect.poll(() => gh.commits.size).toBe(before + 1);
  await ctx.close();
});

test('この iPad への保存の接続が切れても、開き直して保存する', async ({ page }) => {
  await open(page);
  // Safari で裏に回った後に起きる「接続が切れた」状態を、下の接続を閉じて再現する
  await page.evaluate(() => (window as any).tsugigami.store.db.close());
  await penLine(page, 200);
  await penLine(page, 260);
  await page.evaluate(() => (window as any).tsugigami.store.flush());
  expect(await page.evaluate(() => (window as any).tsugigami.store.status)).toEqual({ pending: 0, error: null });
  await expect(page.locator('#saveWarn')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  expect(await page.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(2);
});

test('長いノート(約 1 万本)のバックアップ: 最初の 1 回と、1 本書き足した後', async ({ browser }, info) => {
  test.setTimeout(180_000);
  const gh = new FakeGitHub();
  const ctx = await browser.newContext();
  await routeGitHub(ctx, gh);
  const page = await ctx.newPage();
  await open(page);
  await page.evaluate(() => {
    const { doc } = (window as any).tsugigami;
    const list = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let pg = 0; pg < 30; pg++) for (let row = 0; row < 30; row++) for (let k = 0; k < 11; k++) {
      const x0 = 40 + k * 66, y0 = pg * 1139 + 40 + row * 34, pts = [];
      for (let i = 0; i < 40; i++) pts.push(x0 + i * 1.4 + rnd() * 3, y0 + Math.sin(i / 3) * 8 + rnd() * 2, 0.5);
      list.push({ id: crypto.randomUUID(), noteId: doc.note.id, kind: 'pen', color: '#000000', width: 2.2, pts: Float32Array.from(pts), b: [x0 - 3, y0 - 12, x0 + 62, y0 + 12], z: doc.nextZ() });
    }
    doc.exec({ t: 'add', s: list });
  });
  await configure(page, gh);
  await page.click('#scrim');
  const files = [...gh.files().keys()].filter(p => p.endsWith('.json'));
  const bytes = [...gh.files().values()].reduce((a, t) => a + t.length, 0);
  await penLine(page, 300);
  gh.calls = [];
  const ms = await page.evaluate(async () => {
    const T = (window as any).tsugigami, t = performance.now();
    await T.store.flush();
    const f = performance.now() - t;
    await T.auto.run();
    return performance.now() - t;
  });
  const blobs = gh.calls.filter(c => c === 'POST /git/blobs').length;
  info.annotations.push({ type: 'backup', description: `files=${files.length} bytes=${bytes} second=${ms.toFixed(0)}ms blobs=${blobs}` });
  console.log(`[${info.project.name}] files=${files.length} bytes=${(bytes / 1048576).toFixed(1)}MB 1本足した後=${ms.toFixed(0)}ms 送った blob=${blobs}`);
  expect(files.length).toBe(31); // note.json + 30 ページ
  expect(blobs).toBeLessThanOrEqual(3); // note.json・書いたページ(と、分が変わっていれば README)だけ
  await ctx.close();
});
