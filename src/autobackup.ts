// GitHub への自動バックアップの段取り: いつ走らせるか、前回の状態、失敗したときの再試行。
// 書き終わって少し手が止まったら(IDLE_MS)、書き続けていても一定時間ごとに(MAX_WAIT_MS)、
// アプリが裏に回るとき、起動したとき、通信が戻ったときに走らせる。
import { GitHubBackup, type GitHubConfig, type NoteSource } from './github';
import type { Store } from './store';

const IDLE_MS = 20_000;
const MAX_WAIT_MS = 180_000;
const RETRY_MS = 60_000;

export interface AutoStatus {
  configured: boolean;
  running: boolean;
  /** 最後に成功した時刻 */
  lastOk: number | null;
  /** 直近の失敗(成功したら null) */
  error: string | null;
  /** まだ GitHub に送っていない変更がある */
  dirty: boolean;
}

interface Saved { repo: string; notes: Record<string, string> }

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class AutoBackup {
  onStatus: (s: AutoStatus) => void = () => {};
  cfg: GitHubConfig | null = null;
  private lastOk: number | null = null;
  private error: string | null = null;
  private dirty = false;
  private changes = 0;
  private firstDirty = 0;
  private timer = 0;
  private running: Promise<void> | null = null;
  private again = false;

  /**
   * @param source 送る内容の読み出し元。開いているノートは画面上(メモリ)の内容を渡すと、保存領域から読み直さずに済む
   * @param busy ペンで書いている最中なら true(その間は送る準備の重い処理を始めない)
   */
  constructor(private store: Store, private source: NoteSource = store, private busy: () => boolean = () => false, private fetchImpl?: Fetch) {}

  get status(): AutoStatus {
    return { configured: !!this.cfg, running: !!this.running, lastOk: this.lastOk, error: this.error, dirty: this.dirty };
  }

  async load(): Promise<void> {
    this.cfg = (await this.store.getMeta<GitHubConfig>('github')) ?? null;
    this.lastOk = (await this.store.getMeta<number>('github:lastOk')) ?? null;
    this.dirty = (await this.store.getMeta<boolean>('github:dirty')) ?? false;
    this.emit();
  }

  /** 設定を確かめて保存する。repo が変わったら前回の状態は捨てる(全部送り直す) */
  async configure(cfg: GitHubConfig | null): Promise<void> {
    if (cfg) await new GitHubBackup(cfg, this.fetchImpl).check();
    const old = this.cfg;
    this.cfg = cfg;
    await this.store.setMeta('github', cfg);
    if (!cfg || old?.repo !== cfg.repo) {
      await this.store.setMeta('github:state', null);
      this.lastOk = null;
      await this.store.setMeta('github:lastOk', null);
    }
    this.error = null;
    this.emit();
    if (cfg) await this.run();
  }

  /** ノートに変更があった(書いた・消した・改名した…) */
  changed(): void {
    this.changes++;
    if (!this.dirty) {
      this.dirty = true;
      this.firstDirty = Date.now();
      this.store.setMeta('github:dirty', true).catch(() => {});
      this.emit();
    }
    this.schedule(IDLE_MS);
  }

  /** ノートを完全に削除した。repo からも消す */
  async noteDeleted(id: string): Promise<void> {
    const list = (await this.store.getMeta<string[]>('github:removed')) ?? [];
    if (!list.includes(id)) list.push(id);
    await this.store.setMeta('github:removed', list);
    this.changed();
  }

  /** 裏に回るときなど、待たずに送りたいとき */
  soon(): void {
    if (this.dirty || this.error) this.schedule(0);
  }

  private schedule(ms: number): void {
    if (!this.cfg) return;
    clearTimeout(this.timer);
    if (this.dirty && Date.now() - this.firstDirty > MAX_WAIT_MS) ms = 0;
    this.timer = window.setTimeout(() => {
      if (this.busy()) { this.schedule(2000); return; }
      this.run().catch(() => {});
    }, ms);
  }

  /** いま送る。走っている最中なら、終わった後にもう一度走らせる */
  run(): Promise<void> {
    if (!this.cfg) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    clearTimeout(this.timer);
    const cfg = this.cfg;
    this.running = (async () => {
      this.emit();
      const seen = this.changes;
      try {
        await this.store.flush(); // 手元への保存が済んだものを送る
        const prev = await this.store.getMeta<Saved>('github:state');
        const removed = (await this.store.getMeta<string[]>('github:removed')) ?? [];
        const r = await new GitHubBackup(cfg, this.fetchImpl).backup(this.source, prev?.repo === cfg.repo ? prev.notes : {}, removed);
        if (this.cfg !== cfg) return; // 途中で設定が変わった
        await this.store.setMeta('github:state', { repo: cfg.repo, notes: r.state } satisfies Saved);
        const rest = ((await this.store.getMeta<string[]>('github:removed')) ?? []).filter(id => !removed.includes(id));
        await this.store.setMeta('github:removed', rest);
        this.lastOk = Date.now();
        await this.store.setMeta('github:lastOk', this.lastOk);
        this.error = null;
        if (this.changes === seen) {
          this.dirty = false;
          await this.store.setMeta('github:dirty', false);
        }
      } catch (e) {
        this.error = (e as Error)?.message ?? String(e);
        this.schedule(RETRY_MS);
      } finally {
        this.running = null;
        this.emit();
        const now = this.again;
        this.again = false;
        if (now || (this.dirty && this.changes !== seen)) this.schedule(now ? 0 : IDLE_MS);
      }
    })();
    return this.running;
  }

  /** GitHub の内容を読み出す(手元より新しいノートだけ取り込むのは Store.importAll の役目) */
  async restore(): Promise<number> {
    if (!this.cfg) throw new Error('GitHub の設定がありません');
    await this.store.flush();
    return this.store.importAll(await new GitHubBackup(this.cfg, this.fetchImpl).restore());
  }

  private emit(): void { this.onStatus(this.status); }
}
