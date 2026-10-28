// 実験機(?lab=1): repo の待ち行列のスクリプトを拾い、本物のアプリ上で実行して、結果を commit する。
// GitHub はメモリ上の偽物。lab は別の保存領域を使い、本物のノートに触らない。
import { type BrowserContext, expect, test } from '@playwright/test';
import { FakeGitHub } from '../tests/fakeGitHub';

test.use({ serviceWorkers: 'block' });

async function routeGitHub(ctx: BrowserContext, gh: FakeGitHub) {
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request();
    const res = await gh.fetch(req.url(), { method: req.method(), headers: await req.allHeaders(), body: req.postData() ?? undefined });
    await route.fulfill({ status: res.status, body: await res.text(), headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  });
}

const SCRIPT = `
const env = lab.env();
lab.log('dpr', env.dpr);
await lab.note();
await lab.view(0, 0, 1);
const pts = [];
for (let i = 0; i <= 100; i++) pts.push([100 + i * 2, 200 + 20 * Math.sin(i / 8)]);
await lab.stroke(pts, { gap: 0 });
const shot = await lab.shot('line', [80, 160, 320, 240]);
lab.save('strokes.json', lab.strokes());
return { strokes: lab.strokes().length, shot };
`;

test('待ち行列のスクリプトを実行し、PNG と JSON を結果として送る', async ({ browser }) => {
  const gh = new FakeGitHub();
  await gh.pushFromElsewhere('README.md', '# notes\n');
  await gh.pushFromElsewhere('experiments/queue/001-line.js', SCRIPT);
  const ctx = await browser.newContext();
  await routeGitHub(ctx, gh);
  const page = await ctx.newPage();
  await page.goto('./?lab=1&poll=1');
  await page.waitForSelector('#lab .lab-cfg:not([hidden])');
  await page.fill('#lab .lab-repo', gh.repo);
  await page.fill('#lab .lab-token', gh.token);
  await page.click('#lab .lab-cfg button');
  await expect.poll(() => gh.files().has('experiments/results/001-line/status.json'), { timeout: 20000 }).toBe(true);

  const st = JSON.parse(gh.files().get('experiments/results/001-line/status.json')!);
  expect(st.ok, st.error).toBe(true);
  expect(st.returned.strokes).toBe(1);
  expect(st.env.dpr).toBe(2);
  const png = gh.binaries().get('experiments/results/001-line/line.png')!;
  expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(st.returned.shot.w).toBe(480);
  const strokes = JSON.parse(gh.files().get('experiments/results/001-line/strokes.json')!);
  expect(strokes[0].pts.length).toBeGreaterThan(100);
  expect(gh.files().has('experiments/queue/001-line.js')).toBe(false);
  expect(gh.files().get('experiments/results/001-line/script.js')).toBe(SCRIPT);

  // 本物のノートには触っていない(同じ origin の普通のページは空のまま)
  const main = await ctx.newPage();
  await main.goto('./');
  await main.waitForFunction(() => (window as any).tsugigami?.doc);
  expect(await main.evaluate(() => (window as any).tsugigami.doc.strokes.size)).toBe(0);
  expect(await main.evaluate(() => (window as any).tsugigami.store.listNotes().then((n: unknown[]) => n.length))).toBe(1);
});
