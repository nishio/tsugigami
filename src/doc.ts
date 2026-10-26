// 開いているノート 1 冊ぶんのメモリ上の状態: ストローク、空間索引、取り消し履歴。
// 変更はすべて Op を通し、適用と同時に保存先(sink)へ流す。
import { overlaps } from './geom';
import { type Box, type Note, type Page, type Stroke, pageTop } from './model';

export type Op =
  | { t: 'add'; s: Stroke[] }
  | { t: 'del'; s: Stroke[] }
  | { t: 'swap'; before: Stroke[]; after: Stroke[] }
  | { t: 'pages'; before: Page[]; after: Page[] };

export function inverse(op: Op): Op {
  switch (op.t) {
    case 'add': return { t: 'del', s: op.s };
    case 'del': return { t: 'add', s: op.s };
    case 'swap': return { t: 'swap', before: op.after, after: op.before };
    case 'pages': return { t: 'pages', before: op.after, after: op.before };
  }
}

export interface DocSink {
  saveStrokes(put: Stroke[], del: string[]): void;
  saveNote(note: Note): void;
  /** 見た目が変わった範囲。null は全体 */
  invalidate(box: Box | null): void;
}

/** 空間索引のマス目の一辺 */
export const CELL = 256;
const HISTORY_MAX = 500;

export class Doc {
  readonly strokes = new Map<string, Stroke>();
  /** 選択中などで、タイルに描かない(別レイヤーで描く)ストローク */
  readonly hidden = new Set<string>();
  undoStack: Op[] = [];
  redoStack: Op[] = [];
  private cells = new Map<string, Set<Stroke>>();
  private zMax = 0;

  constructor(public note: Note, strokes: Stroke[], private sink: DocSink) {
    for (const s of strokes) this.insert(s);
  }

  nextZ(): number { return ++this.zMax; }

  /** box に重なるストローク(順不同) */
  query(box: Box): Stroke[] {
    const out = new Set<Stroke>();
    this.eachCell(box, k => {
      const c = this.cells.get(k);
      if (c) for (const s of c) if (overlaps(s.b, box)) out.add(s);
    });
    return [...out];
  }

  /** 適用して履歴に積む */
  exec(op: Op): void {
    this.apply(op);
    this.record(op);
  }

  /** すでに適用済みの変更を履歴にだけ積む(消しゴムのように少しずつ適用したもの) */
  record(op: Op): void {
    this.undoStack.push(op);
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;
    this.apply(inverse(op));
    this.redoStack.push(op);
    return true;
  }

  redo(): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;
    this.apply(op);
    this.undoStack.push(op);
    return true;
  }

  /** 履歴に積まずに適用し、保存する */
  apply(op: Op): void {
    const put: Stroke[] = [], del: string[] = [];
    const add = (list: Stroke[]) => { for (const s of list) { this.insert(s); put.push(s); this.sink.invalidate(s.b); } };
    const rm = (list: Stroke[]) => { for (const s of list) { this.remove(s.id); del.push(s.id); this.sink.invalidate(s.b); } };
    switch (op.t) {
      case 'add': add(op.s); break;
      case 'del': rm(op.s); break;
      case 'swap': rm(op.before); add(op.after); break;
      case 'pages': this.note.pages = op.after.map(p => ({ ...p })); this.sink.invalidate(null); break;
    }
    // 削除と追加で同じ id が出る(swap)ときは追加を優先する
    const putIds = new Set(put.map(s => s.id));
    if (put.length || del.length) this.sink.saveStrokes(put, del.filter(id => !putIds.has(id)));
    this.ensureTrailingPage();
    this.note.updated = Date.now();
    this.sink.saveNote(this.note);
  }

  /** 最後のページに何か書かれたら、その下に白紙のページを 1 枚足す */
  private ensureTrailingPage(): void {
    let bottom = -Infinity;
    for (const s of this.strokes.values()) if (s.b[3] > bottom) bottom = s.b[3];
    let grew = false;
    while (bottom > pageTop(this.note.pages.length - 1)) { this.note.pages.push({ w: 1 }); grew = true; }
    if (grew) this.sink.invalidate(null);
  }

  private insert(s: Stroke): void {
    this.remove(s.id);
    this.strokes.set(s.id, s);
    if (s.z > this.zMax) this.zMax = s.z;
    this.eachCell(s.b, k => {
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, c = new Set());
      c.add(s);
    });
  }

  private remove(id: string): void {
    const s = this.strokes.get(id);
    if (!s) return;
    this.strokes.delete(id);
    this.eachCell(s.b, k => {
      const c = this.cells.get(k);
      if (c) { c.delete(s); if (!c.size) this.cells.delete(k); }
    });
  }

  private eachCell(b: Box, f: (key: string) => void): void {
    const x0 = Math.floor(b[0] / CELL), x1 = Math.floor(b[2] / CELL);
    const y0 = Math.floor(b[1] / CELL), y1 = Math.floor(b[3] / CELL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) f(x + ',' + y);
  }
}
