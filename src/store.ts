// IndexedDB への保存。ストロークは 1 本ずつ別レコードにして、書くたびに差分だけ書き込む。
//
// 書き込みはすべて 1 本の列に並べて順に実行し、失敗したら保存領域を開き直して、成功するまで再試行する。
// iPad の Safari では、アプリが裏に回ったあと IndexedDB との接続が切れ、以後の書き込みが全部失敗する
// ことがある("Connection to Indexed Database server lost")。開き直せば直るので、書いた線は列に残して待つ。
import type { Note, Stroke } from './model';

const DB_NAME = 'tsugigami';
const DB_VERSION = 1;

export interface Backup {
  format: 'tsugigami-backup';
  version: 1;
  exported: number;
  notes: Note[];
  strokes: (Omit<Stroke, 'pts'> & { pts: number[] })[];
}

/** 書き込みはディスクに届いてから完了とする(Chrome の既定は relaxed。Safari は無視する) */
const STRICT = { durability: 'strict' } as IDBTransactionOptions;

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((ok, ng) => { r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
const done = (tx: IDBTransaction): Promise<void> => new Promise((ok, ng) => { tx.oncomplete = () => ok(); tx.onerror = () => ng(tx.error); tx.onabort = () => ng(tx.error); });

/** 再試行の間隔(ms)。最後の値で続ける */
const RETRY_MS = [100, 500, 2000, 5000];

export interface SaveStatus {
  /** まだ保存できていない書き込みの数 */
  pending: number;
  /** 直近の失敗(成功したら null) */
  error: string | null;
}

export class Store {
  /** 保存の状態が変わったとき */
  onStatus: (s: SaveStatus) => void = () => {};
  /** ノートかストロークの書き込みを受け付けたとき(自動バックアップの合図) */
  onChange: () => void = () => {};
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private error: string | null = null;
  private broken = false;

  private constructor(private db: IDBDatabase, private name: string) {
    this.watch(db);
  }

  static async open(name = DB_NAME): Promise<Store> {
    return new Store(await Store.connect(name), name);
  }

  private static connect(name: string): Promise<IDBDatabase> {
    return new Promise((ok, ng) => {
      const r = indexedDB.open(name, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('notes', { keyPath: 'id' });
        db.createObjectStore('strokes', { keyPath: 'id' }).createIndex('noteId', 'noteId');
        db.createObjectStore('meta');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ng(r.error);
    });
  }

  private watch(db: IDBDatabase): void {
    // 異常な切断(onclose)や、別のタブが版を上げようとしたとき(onversionchange)は、次の操作の前に開き直す
    db.onclose = () => { this.broken = true; };
    db.onversionchange = () => { db.close(); this.broken = true; };
  }

  private async reopen(): Promise<void> {
    try { this.db.close(); } catch { /* すでに閉じている */ }
    this.db = await Store.connect(this.name);
    this.watch(this.db);
    this.broken = false;
  }

  close(): void { this.db.close(); }

  /** 保存できていない書き込みが残っているか */
  get status(): SaveStatus { return { pending: this.pending, error: this.error }; }

  /** 列に並んだ書き込みがすべて終わるまで待つ */
  flush(): Promise<void> { return this.queue; }

  /**
   * 書き込みを列に並べる。失敗したら開き直して成功するまで再試行する(諦めない)。
   * 戻り値は成功したときに解決する。retry=false のものは 1 回開き直して駄目なら失敗を返す(利用者の操作など)。
   */
  private write(f: (db: IDBDatabase) => Promise<void>, retry = true): Promise<void> {
    this.pending++;
    this.emit();
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          if (this.broken) await this.reopen();
          await f(this.db);
          this.pending--;
          if (this.error && !this.pending) this.error = null;
          this.emit();
          return;
        } catch (e) {
          this.broken = true;
          this.error = (e as Error)?.message ?? String(e);
          this.emit();
          if (!retry && attempt >= 1) { this.pending--; this.emit(); throw e; }
          await new Promise(ok => setTimeout(ok, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]));
        }
      }
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** 読み出し。接続が切れていたら 1 回だけ開き直す */
  private async read<T>(f: (db: IDBDatabase) => Promise<T>): Promise<T> {
    try {
      if (this.broken) await this.reopen();
      return await f(this.db);
    } catch {
      await this.reopen();
      return f(this.db);
    }
  }

  private emit(): void { this.onStatus(this.status); }

  async listNotes(): Promise<Note[]> {
    return this.read(db => req(db.transaction('notes').objectStore('notes').getAll() as IDBRequest<Note[]>));
  }

  async getNote(id: string): Promise<Note | undefined> {
    return this.read(db => req(db.transaction('notes').objectStore('notes').get(id) as IDBRequest<Note | undefined>));
  }

  /** ノートの書き込み。呼んだ時点の内容を写して並べる(後で書き換わっても、並べた順の内容で保存する) */
  putNote(note: Note): Promise<void> {
    const copy = structuredClone(note);
    this.onChange();
    return this.write(db => {
      const tx = db.transaction('notes', 'readwrite', STRICT);
      tx.objectStore('notes').put(copy);
      return done(tx);
    });
  }

  async strokesOf(noteId: string): Promise<Stroke[]> {
    return this.read(db => req(db.transaction('strokes').objectStore('strokes').index('noteId').getAll(noteId) as IDBRequest<Stroke[]>));
  }

  /** ストロークは書いた後に変更しない(変形や色替えは新しいストロークになる)ので、写さずに並べる */
  saveStrokes(put: Stroke[], del: string[]): Promise<void> {
    this.onChange();
    return this.write(db => {
      const tx = db.transaction('strokes', 'readwrite', STRICT), os = tx.objectStore('strokes');
      for (const id of del) os.delete(id);
      for (const s of put) os.put(s);
      return done(tx);
    });
  }

  /** ノートとそのストロークを完全に消す */
  deleteNote(id: string): Promise<void> {
    this.onChange();
    return this.write(db => {
      const tx = db.transaction(['notes', 'strokes'], 'readwrite', STRICT);
      tx.objectStore('notes').delete(id);
      const os = tx.objectStore('strokes'), keys = os.index('noteId').getAllKeys(id);
      keys.onsuccess = () => { for (const k of keys.result) os.delete(k); };
      return done(tx);
    }, false);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.read(db => req(db.transaction('meta').objectStore('meta').get(key) as IDBRequest<T | undefined>));
  }

  setMeta(key: string, value: unknown): Promise<void> {
    const copy = structuredClone(value);
    return this.write(db => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(copy, key);
      return done(tx);
    });
  }

  async allStrokes(): Promise<Stroke[]> {
    return this.read(db => req(db.transaction('strokes').objectStore('strokes').getAll() as IDBRequest<Stroke[]>));
  }

  async exportAll(now = Date.now()): Promise<Backup> {
    const notes = await this.listNotes();
    const all = await this.allStrokes();
    return {
      format: 'tsugigami-backup', version: 1, exported: now, notes,
      strokes: all.map(s => ({ ...s, pts: Array.from(s.pts, v => Math.round(v * 1000) / 1000) })),
    };
  }

  /**
   * バックアップを取り込む。同じ id のノートは、バックアップ側が新しいときだけ置き換える。
   * 戻り値は置き換え・追加したノートの数。
   */
  async importAll(data: Backup): Promise<number> {
    if (data?.format !== 'tsugigami-backup' || data.version !== 1) throw new Error('tsugigami のバックアップファイルではありません');
    const byNote = new Map<string, Stroke[]>();
    for (const s of data.strokes) {
      const list = byNote.get(s.noteId) ?? [];
      list.push({ ...s, pts: Float32Array.from(s.pts) });
      byNote.set(s.noteId, list);
    }
    let n = 0;
    for (const note of data.notes) {
      const cur = await this.getNote(note.id);
      if (cur && cur.updated >= note.updated) continue;
      // 古い線の削除と新しい内容の書き込みを 1 つのトランザクションにする。
      // 途中で失敗しても、手元のノートが消えたまま残らない(全部戻る)
      await this.write(db => {
        const tx = db.transaction(['notes', 'strokes'], 'readwrite', STRICT);
        const os = tx.objectStore('strokes');
        const keys = os.index('noteId').getAllKeys(note.id);
        keys.onsuccess = () => {
          for (const k of keys.result) os.delete(k);
          tx.objectStore('notes').put(note);
          for (const st of byNote.get(note.id) ?? []) os.put(st);
        };
        return done(tx);
      }, false);
      this.onChange();
      n++;
    }
    return n;
  }
}
