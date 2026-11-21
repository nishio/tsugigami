/** 画面が実行している版と、公開サーバが返す版を分けて扱う。 */
export interface Build { id: string; commit: string; builtAt: string }

export async function fetchBuild(base: string): Promise<Build> {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch(`${base}version.json?check=${Date.now()}`, { cache: 'no-store', signal: abort.signal });
    if (!response.ok) throw new Error('版の取得に失敗');
    const b = await response.json();
    if (typeof b?.id !== 'string' || !b.id || b.id.length > 160 || typeof b.commit !== 'string' ||
        typeof b.builtAt !== 'string' || !Number.isFinite(Date.parse(b.builtAt))) throw new Error('版の形式が不正');
    return b;
  } finally { clearTimeout(timer); }
}

function workerBuild(worker: ServiceWorker): Promise<unknown> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = (id?: unknown) => { clearTimeout(timer); channel.port1.close(); resolve(id); };
    const timer = setTimeout(() => finish(), 500);
    channel.port1.onmessage = e => finish(e.data);
    try { worker.postMessage('BUILD', [channel.port2]); } catch { finish(); }
  });
}

/** 更新されたキャッシュの有効化を確認するまでリロードしない。 */
export async function prepareUpdate(reg: ServiceWorkerRegistration, id: string): Promise<void> {
  await reg.update();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const worker = reg.active;
    if (worker?.state === 'activated' && await workerBuild(worker) === id) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('新版の取得が完了しませんでした。通信を確認してもう一度お試しください');
}

export function showUpdates(options: {
  build: Build; base: string; lab: boolean;
  registration: Promise<ServiceWorkerRegistration | null>;
  save: () => Promise<void>;
  error: (message: string) => void;
}): { check: () => Promise<void> } {
  const el = (id: string) => document.getElementById(id)!;
  const status = el('versionStatus'), check = el('versionCheck') as HTMLButtonElement;
  const update = el('versionUpdate') as HTMLButtonElement, wait = el('updateWait');
  const label = (b: Build) => `${b.commit} · ${new Date(b.builtAt).toLocaleString('ja-JP', { hour12: false })}`;
  el('version').textContent = `使用中: ${label(options.build)}${options.lab ? ' lab' : ''}`;
  el('version').title = options.build.id;
  let checking: Promise<void> | null = null, updating = false;
  const inspect = async (): Promise<void> => {
    check.disabled = true;
    status.textContent = '最新版を確認中…';
    try {
      const latest = await fetchBuild(options.base);
      update.hidden = latest.id === options.build.id;
      status.textContent = update.hidden
        ? `最新版です（${new Date().toLocaleTimeString('ja-JP', { hour12: false })} 確認）`
        : `新版があります: ${label(latest)}`;
    } catch {
      update.hidden = true;
      status.textContent = '最新版を確認できません。通信を確認して再確認してください。';
    } finally { check.disabled = false; }
  };
  const run = () => {
    if (updating) return Promise.resolve();
    return checking ??= inspect().finally(() => { checking = null; });
  };
  // 更新待ちの間に、背後のショートカットや捕捉中の Pencil で保存対象を増やさない。
  for (const type of ['keydown', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    document.addEventListener(type, e => {
      if (!updating) return;
      if (type !== 'keydown' && wait.contains(e.target as Node)) return;
      if (type === 'keydown' && e.target === el('updateCancel') && ['Enter', ' ', 'Tab'].includes((e as KeyboardEvent).key)) return;
      e.preventDefault(); e.stopImmediatePropagation();
    }, { capture: true, passive: false });
  }
  check.onclick = () => { void run(); };
  update.onclick = async () => {
    if (updating) return;
    updating = true; update.disabled = check.disabled = true; wait.hidden = false;
    const cancelled = new Promise<never>((_, reject) => {
      el('updateCancel').onclick = () => reject(new Error('更新を中止しました。保存は続けます'));
    });
    const step = <T>(p: Promise<T>) => Promise.race([p, cancelled]);
    try {
      // 再確認・SW の準備に失敗したら、画面もノートもそのままにする。
      const latest = await step(fetchBuild(options.base)), reg = await step(options.registration);
      if ('serviceWorker' in navigator && !reg) throw new Error('更新の準備ができません。再確認してください');
      if (reg) await step(prepareUpdate(reg, latest.id));
      await step(options.save());
      location.reload();
    } catch (e) {
      options.error((e as Error).message);
      updating = false; update.disabled = check.disabled = false; wait.hidden = true;
    }
  };
  window.addEventListener('online', () => { void run(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void run(); });
  void run();
  return { check: run };
}
