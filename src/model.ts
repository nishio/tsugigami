// データの形と、ページ配置の計算。座標の単位は「等倍時の CSS px」(A4 = 794 × 1123)。

export const PAGE_W = 794;
export const PAGE_H = 1123;
export const PAGE_GAP = 16;
export const GRID = 18.9; // 5mm

/** [x0, y0, x1, y1] */
export type Box = [number, number, number, number];

export type StrokeKind = 'pen' | 'marker';

export interface Stroke {
  id: string;
  noteId: string;
  kind: StrokeKind;
  color: string;
  /** 基準の太さ。ペンは筆圧で 0.35〜1.65 倍に変わる */
  width: number;
  /** x, y, 筆圧 の 3 つ組の並び */
  pts: Float32Array;
  /** 太さ込みの外接矩形 */
  b: Box;
  /** 描画順 */
  z: number;
}

export type Paper = 'plain' | 'grid';

/** ページ。w は A4 何枚分の横幅か(右へ継ぎ足すと増える) */
export interface Page { w: number }

export interface Note {
  id: string;
  title: string;
  created: number;
  updated: number;
  paper: Paper;
  pages: Page[];
  /** ゴミ箱に入れた日時 */
  trashed?: number;
}

export const newId = (): string => crypto.randomUUID();

export function newNote(now = Date.now()): Note {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    id: newId(),
    title: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} のノート`,
    created: now, updated: now, paper: 'grid', pages: [{ w: 1 }, { w: 1 }],
  };
}

export const pageTop = (i: number): number => i * (PAGE_H + PAGE_GAP);

export function pageRect(note: Note, i: number): Box {
  const y = pageTop(i);
  return [0, y, PAGE_W * note.pages[i].w, y + PAGE_H];
}

/** ノート全体(全ページ)を囲む矩形 */
export function noteBounds(note: Note): Box {
  const w = Math.max(...note.pages.map(p => p.w));
  return [0, 0, PAGE_W * w, pageTop(note.pages.length - 1) + PAGE_H];
}

/** y を含む(またはその直上の)ページ番号 */
export function pageIndexAt(note: Note, y: number): number {
  const i = Math.floor(y / (PAGE_H + PAGE_GAP));
  return Math.max(0, Math.min(note.pages.length - 1, i));
}

/**
 * ペンの描く太さ。筆圧は使わず一定(nishio の好み: issue #1「筆圧なし」)。
 * 筆圧は点ごとに記録し続けているので、あとで太さに反映させたくなったらここだけ変えればよい。
 */
export const penWidth = (width: number, _p: number): number => width;

/** ストロークの外接矩形に足す余白(太さの最大値の半分) */
export const strokePad = (kind: StrokeKind, width: number): number => (kind === 'pen' ? penWidth(width, 1) : width) / 2;
