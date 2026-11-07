// lab(?lab=1)で入れた GitHub の設定を、本体の自動バックアップに引き継ぐ(2026-11-07)。
// もとは lab の保存領域にしか残らず、本体は一度も送っていなかった。GitHub はメモリ上の偽物(tests/fakeGitHub.ts)。
import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { FakeGitHub } from '../tests/fakeGitHub';

test.use({ serviceWorkers: 'block' });
// lab と本体を続けて開くので、WebKit では 1 本 20 秒を超える
test.setTimeout(60000);

async function routeGitHub(ctx: BrowserContext, gh: FakeGitHub) {
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request();
    const res = await gh.fetch(req.url(), { method: req.method(), headers: await req.allHeaders(), body: req.postData() ?? undefined });
    await route.fulfill({ status: res.status, body: await res.text(), headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  });
}

/** lab を開いて repo とトークンを入れる。toMain = false は、この修正の前の lab と同じ状態(lab の保存領域にだけ残る) */
async function setupLab(ctx: BrowserContext, gh: FakeGitHub, toMain: boolean) {
  const page = await ctx.newPage();
  await page.goto('./?lab=1&poll=60');
  await page.waitForSelector('#lab .lab-cfg:not([hidden])');
  await page.fill('#lab .lab-repo', gh.repo);
  await page.fill('#lab .lab-token', gh.token);
  await page.locator('#lab .lab-main').setChecked(toMain);
  await page.click('#lab .lab-cfg button');
  await expect(page.locator('#lab .lab-status')).toContainText('待機中');
  await page.close();
}

async function openMain(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  return page;
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

const noteFiles = (gh: FakeGitHub) => [...gh.files().keys()].filter(p => p.startsWith('notes/'));

test('lab の保存領域にだけ設定がある → 本体を開くと聞かれ、承諾すると notes/ に commit する', async ({ browser }) => {
  const gh = new FakeGitHub();
  await gh.pushFromElsewhere('README.md', '# notes\n');
  await gh.pushFromElsewhere('experiments/results/old/status.json', '{}\n');
  const ctx = await browser.newContext();
  await routeGitHub(ctx, gh);
  await setupLab(ctx, gh, false);

  const page = await openMain(ctx);
  expect(await page.evaluate(() => (window as any).tsugigami.auto.cfg)).toBeNull();
  const offer = page.locator('#labOffer');
  await expect(offer).toBeVisible();
  await expect(offer).toContainText(gh.repo);
  // トークンの値は画面に出さない
  expect(await page.content()).not.toContain(gh.token);

  await penLine(page, 300);
  await offer.locator('[data-act=yes]').click();
  await expect(page.locator('#toast')).toHaveText(`${gh.repo} へ送りました`);
  await expect(offer).toBeHidden();
  const id = await page.evaluate(() => (window as any).tsugigami.doc.note.id as string);
  expect(JSON.parse(gh.files().get(`notes/${id}/p0001.json`)!).strokes).toHaveLength(1);
  // lab の結果には触らない
  expect(gh.files().has('experiments/results/old/status.json')).toBe(true);
  expect(await page.content()).not.toContain(gh.token);

  // 次からは聞かない(本体に設定が入った)。ノート一覧の「未設定」も出ない
  await page.reload();
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  expect(await page.evaluate(() => (window as any).tsugigami.auto.cfg.repo)).toBe(gh.repo);
  await expect(offer).toBeHidden();
  await page.click('#menuBtn');
  await expect(page.locator('#ghUnset')).toBeHidden();
  await ctx.close();
});

test('「しない」を選ぶと起動時には聞かないが、ノート一覧に未設定と「lab の設定で始める」が出続ける', async ({ browser }) => {
  const gh = new FakeGitHub();
  await gh.pushFromElsewhere('README.md', '# notes\n');
  const ctx = await browser.newContext();
  await routeGitHub(ctx, gh);
  await setupLab(ctx, gh, false);

  const page = await openMain(ctx);
  await page.locator('#labOffer [data-act=no]').click();
  await expect(page.locator('#labOffer')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.waitForTimeout(300);
  await expect(page.locator('#labOffer')).toBeHidden();

  await page.click('#menuBtn');
  await expect(page.locator('#ghUnset')).toBeVisible();
  await expect(page.locator('#ghUnset')).toContainText('未設定');
  await page.click('#ghUseLab');
  await expect(page.locator('#toast')).toHaveText(`${gh.repo} へ送りました`);
  await expect(page.locator('#ghUnset')).toBeHidden();
  expect(noteFiles(gh).length).toBeGreaterThan(0);
  await ctx.close();
});

test('lab で新しく入れるとき「本体にも使う」なら、本体は聞かずに送り始める', async ({ browser }) => {
  const gh = new FakeGitHub();
  await gh.pushFromElsewhere('README.md', '# notes\n');
  const ctx = await browser.newContext();
  await routeGitHub(ctx, gh);
  await setupLab(ctx, gh, true);

  const page = await openMain(ctx);
  expect(await page.evaluate(() => (window as any).tsugigami.auto.cfg.repo)).toBe(gh.repo);
  await page.waitForTimeout(300);
  await expect(page.locator('#labOffer')).toBeHidden();
  await penLine(page, 300);
  await page.evaluate(() => (window as any).tsugigami.auto.run());
  const id = await page.evaluate(() => (window as any).tsugigami.doc.note.id as string);
  expect(gh.files().has(`notes/${id}/p0001.json`)).toBe(true);
  await ctx.close();
});

test('lab を開いたことがなければ聞かない。ノート一覧には未設定が出て、lab の保存領域も作らない', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await openMain(ctx);
  await page.waitForTimeout(300);
  await expect(page.locator('#labOffer')).toBeHidden();
  await page.click('#menuBtn');
  await expect(page.locator('#ghUnset')).toBeVisible();
  await expect(page.locator('#ghUseLab')).toBeHidden();
  await page.click('#ghGoSetup');
  await expect(page.locator('#ghSetup')).toHaveAttribute('open', '');
  const names = await page.evaluate(async () => (await indexedDB.databases()).map(d => d.name));
  expect(names).not.toContain('tsugigami-lab');
  await ctx.close();
});
