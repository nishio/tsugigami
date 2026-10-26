// IndexedDB への保存。ストロークは 1 本ずつ別レコードにして、書くたびに差分だけ書き込む。
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

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((ok, ng) => { r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
const done = (tx: IDBTransaction): Promise<void> => new Promise((ok, ng) => { tx.oncomplete = () => ok(); tx.onerror = () => ng(tx.error); tx.onabort = () => ng(tx.error); });

export class Store {
  private constructor(private db: IDBDatabase) {}

  static open(name = DB_NAME): Promise<Store> {
    return new Promise((ok, ng) => {
      const r = indexedDB.open(name, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('notes', { keyPath: 'id' });
        db.createObjectStore('strokes', { keyPath: 'id' }).createIndex('noteId', 'noteId');
        db.createObjectStore('meta');
      };
      r.onsuccess = () => ok(new Store(r.result));
      r.onerror = () => ng(r.error);
    });
  }

  close(): void { this.db.close(); }

  async listNotes(): Promise<Note[]> {
    return req(this.db.transaction('notes').objectStore('notes').getAll() as IDBRequest<Note[]>);
  }

  async getNote(id: string): Promise<Note | undefined> {
    return req(this.db.transaction('notes').objectStore('notes').get(id) as IDBRequest<Note | undefined>);
  }

  async putNote(note: Note): Promise<void> {
    const tx = this.db.transaction('notes', 'readwrite');
    tx.objectStore('notes').put(note);
    return done(tx);
  }

  async strokesOf(noteId: string): Promise<Stroke[]> {
    const idx = this.db.transaction('strokes').objectStore('strokes').index('noteId');
    return req(idx.getAll(noteId) as IDBRequest<Stroke[]>);
  }

  async saveStrokes(put: Stroke[], del: string[]): Promise<void> {
    const tx = this.db.transaction('strokes', 'readwrite'), os = tx.objectStore('strokes');
    for (const id of del) os.delete(id);
    for (const s of put) os.put(s);
    return done(tx);
  }

  /** ノートとそのストロークを完全に消す */
  async deleteNote(id: string): Promise<void> {
    const ids = (await this.strokesOf(id)).map(s => s.id);
    const tx = this.db.transaction(['notes', 'strokes'], 'readwrite');
    tx.objectStore('notes').delete(id);
    const os = tx.objectStore('strokes');
    for (const sid of ids) os.delete(sid);
    return done(tx);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return req(this.db.transaction('meta').objectStore('meta').get(key) as IDBRequest<T | undefined>);
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(value, key);
    return done(tx);
  }

  async exportAll(now = Date.now()): Promise<Backup> {
    const notes = await this.listNotes();
    const all = await req(this.db.transaction('strokes').objectStore('strokes').getAll() as IDBRequest<Stroke[]>);
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
      if (cur) await this.deleteNote(note.id);
      await this.putNote(note);
      await this.saveStrokes(byNote.get(note.id) ?? [], []);
      n++;
    }
    return n;
  }
}
