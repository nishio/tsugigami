// 本物の GitHub に対する確認(CORS、空の repo の扱い、API の形)。普段は飛ばす。
//   GH_REAL_REPO=owner/name GH_REAL_TOKEN=$(gh auth token) npx playwright test github-real --project=chromium
// 確認に使ったノートは最後に「完全に削除」して repo からも消す(履歴には残る)。
import { type Page, expect, test } from '@playwright/test';

const repo = process.env.GH_REAL_REPO, token = process.env.GH_REAL_TOKEN;
test.skip(!repo || !token, 'GH_REAL_REPO と GH_REAL_TOKEN を設定したときだけ');
test.use({ serviceWorkers: 'block' });
test.setTimeout(120_000);

async function setup(page: Page) {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).tsugigami?.doc);
  await page.click('#menuBtn');
  await page.fill('#ghRepo', repo!);
  await page.fill('#ghToken', token!);
  await page.click('#ghSave');
  await expect(page.locator('#toast')).toHaveText('GitHub へ送りました', { timeout: 30_000 });
  await page.click('#scrim');
}

async function wipe(page: Page) {
  await page.evaluate(async () => {
    const T = (window as any).tsugigami;
    for (const n of await T.store.listNotes()) { await T.store.deleteNote(n.id); await T.auto.noteDeleted(n.id); }
    await T.auto.run();
  });
}

test('本物の GitHub に送り、別の端末で読み込める', async ({ browser }) => {
  const a = await browser.newContext(), pa = await a.newPage();
  await setup(pa);
  const id = await pa.evaluate(async () => {
    const T = (window as any).tsugigami, st = document.querySelector('#stage')!, r = st.getBoundingClientRect();
    const ev = (n: string, x: number, y: number, b: number) =>
      st.dispatchEvent(new PointerEvent(n, { bubbles: true, pointerId: 5, pointerType: 'pen', clientX: r.left + x, clientY: r.top + y, buttons: b, pressure: b ? 0.5 : 0 }));
    ev('pointerdown', 100, 200, 1);
    for (let x = 120; x <= 300; x += 20) ev('pointermove', x, 200 + (x % 40), 1);
    ev('pointerup', 300, 200, 0);
    T.doc.note.title = '動作確認(消してよい)';
    await T.store.putNote(T.doc.note);
    await T.auto.run();
    return T.doc.note.id as string;
  });
  expect(await pa.evaluate(() => (window as any).tsugigami.auto.status.error)).toBeNull();

  const b = await browser.newContext(), pb = await b.newPage();
  await setup(pb);
  await pb.click('#menuBtn');
  await pb.click('#ghRestore');
  await expect(pb.locator('#toast')).toContainText('GitHub から読み込みました', { timeout: 30_000 });
  const got = await pb.evaluate(async id => {
    const T = (window as any).tsugigami;
    return { title: (await T.store.getNote(id))?.title, n: (await T.store.strokesOf(id)).length };
  }, id);
  expect(got).toEqual({ title: '動作確認(消してよい)', n: 1 });

  await wipe(pb);
  await wipe(pa);
  expect(await pa.evaluate(() => (window as any).tsugigami.auto.status.error)).toBeNull();
  await a.close(); await b.close();
});
