// 描画。書き終わった線はタイル(ノート座標の正方形)ごとにビットマップへ焼いてキャッシュし、
// スクロールやズームではタイルを貼り直すだけにする。書いている最中の線は別レイヤー(controller 側)。
import type { Doc } from './doc';
import { type Mat, overlaps } from './geom';
import { type Box, GRID, type Note, PAGE_GAP, PAGE_W, type Stroke, noteBounds, pageRect, penWidth } from './model';

export const DESK = '#e6e4de';
export const PAPER = '#fdfcf8';
const PAGE_EDGE = '#d3cfc4';
const GRID_LINE = '#e3dfd3';
const MARKER_ALPHA = 0.38;

export interface View { x: number; y: number; s: number }

/** 描くのに要る最小限(書いている途中の線は pts が普通の配列) */
export interface Ink { pts: ArrayLike<number>; width: number; color: string }

// ---- ストロークの描き方(タイルとライブ描画で共用) ----

/** 太さの量子化。同じ太さが続く区間を 1 つのパスにまとめて描画命令を減らす */
const qw = (w: number) => Math.round(w * 8) / 8;

/**
 * ペンを描く。点 i から点 i+1 への区間は「中点から中点への二次曲線」。
 * from 以降の区間だけ描く(ライブ描画の差分用)。最後の中点からペン先までの残りは tail で描く。
 */
export function drawPenSegments(ctx: CanvasRenderingContext2D, s: Ink, from = 1, clip?: Box): void {
  const P = s.pts, n = P.length / 3;
  ctx.strokeStyle = s.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let open = false, cw = -1;
  for (let i = Math.max(1, from); i < n; i++) {
    const j = i * 3, x1 = P[j - 3], y1 = P[j - 2], x2 = P[j], y2 = P[j + 1];
    if (clip) {
      const m = s.width * 2;
      if (Math.max(x1, x2) < clip[0] - m || Math.min(x1, x2) > clip[2] + m || Math.max(y1, y2) < clip[1] - m || Math.min(y1, y2) > clip[3] + m) {
        if (open) { ctx.stroke(); open = false; }
        continue;
      }
    }
    const w = qw(penWidth(s.width, (P[j - 1] + P[j + 2]) / 2));
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    if (!open || w !== cw) {
      if (open) ctx.stroke();
      ctx.lineWidth = cw = w;
      ctx.beginPath();
      if (i === 1) ctx.moveTo(x1, y1); else ctx.moveTo((P[j - 6] + x1) / 2, (P[j - 5] + y1) / 2);
      open = true;
    }
    if (i === 1) ctx.lineTo(mx, my); else ctx.quadraticCurveTo(x1, y1, mx, my);
  }
  if (open) ctx.stroke();
}

/** 最後の中点からペン先まで。pred は予測点(ライブ描画のみ) */
export function drawPenTail(ctx: CanvasRenderingContext2D, s: Ink, pred?: number[][]): void {
  const P = s.pts, n = P.length / 3, j = (n - 1) * 3;
  ctx.strokeStyle = ctx.fillStyle = s.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const w = penWidth(s.width, P[j + 2]);
  if (n === 1 && !pred?.length) {
    ctx.beginPath(); ctx.arc(P[0], P[1], w / 2, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.lineWidth = w;
  ctx.beginPath();
  if (n === 1) ctx.moveTo(P[0], P[1]); else ctx.moveTo((P[j - 3] + P[j]) / 2, (P[j - 2] + P[j + 1]) / 2);
  ctx.lineTo(P[j], P[j + 1]);
  if (pred) for (const q of pred) ctx.lineTo(q[0], q[1]);
  ctx.stroke();
}

/** マーカーは 1 本を 1 つのパスで塗る(自分自身との重なりが濃くならない) */
export function drawMarker(ctx: CanvasRenderingContext2D, s: Ink): void {
  const P = s.pts, n = P.length / 3;
  ctx.save();
  ctx.globalAlpha = MARKER_ALPHA;
  ctx.strokeStyle = ctx.fillStyle = s.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = s.width;
  ctx.beginPath();
  if (n === 1) { ctx.arc(P[0], P[1], s.width / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
  ctx.moveTo(P[0], P[1]);
  for (let j = 3; j < P.length; j += 3) ctx.lineTo(P[j], P[j + 1]);
  ctx.stroke();
  ctx.restore();
}

/**
 * 書き終わった線のパス。点の列は変わらないので、ストロークごとに 1 回だけ作って使い回す。
 * ペンは筆圧で太さが変わる輪郭を 1 つの多角形にして塗る(区間ごとに描くより描画命令が 1/数十 になる)。
 * 鋭く折り返す所で輪郭が裏返って欠けるのを、細い中心線を重ねて埋める。
 */
interface StrokePaths { fill?: Path2D; line: Path2D; lw: number }
const pathCache = new WeakMap<Stroke, StrokePaths>();

function strokePaths(s: Stroke): StrokePaths {
  let c = pathCache.get(s);
  if (c) return c;
  const P = s.pts, n = P.length / 3, line = new Path2D();
  line.moveTo(P[0], P[1]);
  for (let j = 3; j < P.length; j += 3) line.lineTo(P[j], P[j + 1]);
  if (s.kind === 'marker') {
    if (n === 1) line.lineTo(P[0] + 0.01, P[1]);
    c = { line, lw: s.width };
  } else {
    const fill = new Path2D();
    let minR = Infinity;
    if (n === 1) {
      const r = penWidth(s.width, P[2]) / 2;
      fill.arc(P[0], P[1], r, 0, Math.PI * 2);
      minR = r;
    } else {
      const L: number[] = [], R: number[] = [];
      let a0 = 0, a1 = 0;
      for (let i = 0; i < n; i++) {
        const p = Math.max(0, i - 1) * 3, q = Math.min(n - 1, i + 1) * 3;
        let tx = P[q] - P[p], ty = P[q + 1] - P[p + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const r = penWidth(s.width, P[i * 3 + 2]) / 2, x = P[i * 3], y = P[i * 3 + 1];
        if (r < minR) minR = r;
        L.push(x - ty * r, y + tx * r);
        R.push(x + ty * r, y - tx * r);
        if (i === 0) a0 = Math.atan2(tx, -ty);
        if (i === n - 1) a1 = Math.atan2(tx, -ty);
      }
      const side = (A: number[], rev: boolean) => {
        const k = A.length / 2, at = (i: number) => (rev ? k - 1 - i : i) * 2;
        for (let i = 1; i < k - 1; i++) {
          const u = at(i), v = at(i + 1);
          fill.quadraticCurveTo(A[u], A[u + 1], (A[u] + A[v]) / 2, (A[u + 1] + A[v + 1]) / 2);
        }
        const e = at(k - 1);
        fill.lineTo(A[e], A[e + 1]);
      };
      const e = (n - 1) * 3;
      fill.moveTo(L[0], L[1]);
      side(L, false);
      fill.arc(P[e], P[e + 1], penWidth(s.width, P[e + 2]) / 2, a1, a1 - Math.PI, true);
      side(R, true);
      fill.arc(P[0], P[1], penWidth(s.width, P[2]) / 2, a0 + Math.PI, a0, true);
      fill.closePath();
    }
    c = { fill, line, lw: minR * 1.2 };
  }
  pathCache.set(s, c);
  return c;
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const c = strokePaths(s);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = s.color;
  if (s.kind === 'marker') {
    ctx.save();
    ctx.globalAlpha = MARKER_ALPHA;
    ctx.lineWidth = c.lw;
    ctx.stroke(c.line);
    ctx.restore();
    return;
  }
  ctx.fill(c.fill!);
  ctx.lineWidth = c.lw;
  ctx.stroke(c.line);
}

/** マーカーを下、ペンを上。それぞれ書いた順 */
export function paintOrder(list: Stroke[]): Stroke[] {
  return list.sort((a, b) => (a.kind === b.kind ? a.z - b.z : a.kind === 'marker' ? -1 : 1));
}

/** ページの紙と方眼(ノート座標で描く。ctx にはノート→画面の変換が入っている前提) */
export function drawPaper(ctx: CanvasRenderingContext2D, note: Note, area: Box, px: number): void {
  for (let i = 0; i < note.pages.length; i++) {
    const r = pageRect(note, i);
    if (!overlaps(r, area)) continue;
    ctx.fillStyle = PAPER;
    ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    if (note.paper === 'grid') {
      ctx.strokeStyle = GRID_LINE; ctx.lineWidth = px;
      ctx.beginPath();
      const x0 = Math.max(r[0], area[0]), x1 = Math.min(r[2], area[2]);
      const y0 = Math.max(r[1], area[1]), y1 = Math.min(r[3], area[3]);
      for (let x = r[0] + Math.ceil((x0 - r[0]) / GRID) * GRID; x <= x1; x += GRID) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (let y = r[1] + Math.ceil((y0 - r[1]) / GRID) * GRID; y <= y1; y += GRID) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
    }
    // 右へ継いだ紙の継ぎ目
    if (note.pages[i].w > 1) {
      ctx.strokeStyle = PAGE_EDGE; ctx.lineWidth = px; ctx.setLineDash([6 * px, 6 * px]);
      ctx.beginPath();
      for (let k = 1; k < note.pages[i].w; k++) { ctx.moveTo(PAGE_W * k, r[1]); ctx.lineTo(PAGE_W * k, r[3]); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = PAGE_EDGE; ctx.lineWidth = px;
    ctx.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
  }
}

// ---- タイル ----

const TILE = 256;
const TILE_PX_MAX = 1024;
const CACHE_BYTES = 120 * 1024 * 1024;
const FRAME_BUDGET_MS = 10;

interface Tile { c: HTMLCanvasElement; rs: number; dirty: boolean; used: number; bytes: number }

/** 描画倍率 rs でタイルの画素数が上限を超えないよう、タイルの一辺を 2^-k に縮める */
const levelFor = (rs: number, dpr: number) => Math.max(0, Math.ceil(Math.log2((TILE * rs * dpr) / TILE_PX_MAX)));

export class Renderer {
  readonly base: HTMLCanvasElement;
  readonly live: HTMLCanvasElement;
  readonly wet: HTMLCanvasElement;
  readonly bctx: CanvasRenderingContext2D;
  readonly lctx: CanvasRenderingContext2D;
  readonly wctx: CanvasRenderingContext2D;
  view: View = { x: 0, y: 0, s: 1 };
  /** タイルを焼く倍率。ズーム中は据え置き、指を離したら view.s に合わせる */
  rs = 1;
  dpr = 1;
  W = 0;
  H = 0;
  doc: Doc | null = null;
  /** 合成のたびに呼ばれる(選択中の線や操作つまみを描き直す) */
  onOverlay: () => void = () => {};
  onViewChange: () => void = () => {};
  private tiles = new Map<string, Tile>();
  private bytes = 0;
  private frame = 0;
  private clock = 0;
  private prefetchTimer = 0;
  private held = false;
  private deferred = false;

  constructor(private stage: HTMLElement) {
    const mk = () => { const c = document.createElement('canvas'); c.className = 'layer'; stage.append(c); return c; };
    this.base = mk(); this.live = mk(); this.wet = mk();
    this.bctx = this.base.getContext('2d', { alpha: false })!;
    // 書いている最中の線は低遅延モードで描く(対応していないブラウザでは無視される)
    this.lctx = this.live.getContext('2d', { desynchronized: true })!;
    this.wctx = this.wet.getContext('2d', { desynchronized: true })!;
  }

  get lowLatency(): boolean {
    const a = this.lctx.getContextAttributes?.() as (CanvasRenderingContext2DSettings | undefined);
    return !!a?.desynchronized;
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.W = this.stage.clientWidth; this.H = this.stage.clientHeight;
    for (const c of [this.base, this.live, this.wet]) {
      c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr);
      c.style.width = this.W + 'px'; c.style.height = this.H + 'px';
    }
    this.clampView();
    this.settle();
  }

  setDoc(doc: Doc | null): void {
    this.doc = doc;
    this.dropTiles();
    this.request();
  }

  dropTiles(): void { this.tiles.clear(); this.bytes = 0; }

  /**
   * box の範囲のタイルを汚す(次の合成で必ず焼き直す)。
   * null は全体: 古い絵を見せたまま、時間の許す範囲で順に焼き直す(紙の種類の切り替えなど)。
   */
  invalidate(box: Box | null): void {
    for (const [key, t] of this.tiles) {
      if (!box) { t.rs = -1; continue; }
      const [k, tx, ty] = key.split(':').map(Number), tw = TILE / 2 ** k;
      if (overlaps(box, [tx * tw, ty * tw, (tx + 1) * tw, (ty + 1) * tw])) t.dirty = true;
    }
    this.request();
  }

  toWorld(sx: number, sy: number): [number, number] {
    const v = this.view;
    return [(sx - v.x) / v.s, (sy - v.y) / v.s];
  }

  toScreen(x: number, y: number): [number, number] {
    const v = this.view;
    return [x * v.s + v.x, y * v.s + v.y];
  }

  /** ノート→画面の変換を ctx に入れる */
  setWorld(ctx: CanvasRenderingContext2D, m?: Mat): void {
    const v = this.view, d = this.dpr;
    ctx.setTransform(d * v.s, 0, 0, d * v.s, d * v.x, d * v.y);
    if (m) ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  }

  clear(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  /** 1 枚目の紙の幅を画面幅に合わせる倍率 */
  fitScale(): number {
    // 左右に「紙を継ぎ足す」ボタンが収まる余白を残す
    return Math.min(2, Math.max(0.3, (this.W - 76) / PAGE_W));
  }

  fitView(top = 0): void {
    const s = this.fitScale();
    this.view = { s, x: (this.W - PAGE_W * s) / 2, y: 12 - top * s };
    this.clampView();
    this.settle();
  }

  /** ノートの外へ行き過ぎないように表示位置を制限する */
  clampView(): void {
    const doc = this.doc;
    if (!doc) return;
    const v = this.view, b = noteBounds(doc.note), m = 40;
    const cw = (b[2] - b[0]) * v.s, ch = (b[3] - b[1]) * v.s;
    if (cw + 2 * m <= this.W) v.x = (this.W - cw) / 2;
    else v.x = Math.min(m, Math.max(this.W - cw - m, v.x));
    v.y = Math.min(m + PAGE_GAP, Math.max(Math.min(m, this.H - ch - m), v.y));
  }

  /** ズームが落ち着いたら、タイルを焼く倍率を表示倍率に揃え、画素の境目に位置を合わせる */
  settle(): void {
    const v = this.view, d = this.dpr, k = levelFor(v.s, d), tw = TILE / 2 ** k;
    const rs = Math.round(tw * v.s * d) / (tw * d), f = rs / v.s, cx = this.W / 2, cy = this.H / 2;
    v.x = cx - (cx - v.x) * f; v.y = cy - (cy - v.y) * f;
    v.s = rs; this.rs = rs;
    this.clampView();
    v.x = Math.round(v.x * d) / d; v.y = Math.round(v.y * d) / d;
    this.request();
  }

  request(): void {
    if (this.held) { this.deferred = true; return; }
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  /**
   * ペンで書いている間は、画面全体の合成(先読みや焼き直し)を保留する。
   * 書いている線の描画だけにメインスレッドを使わせるため。
   */
  hold(on: boolean): void {
    this.held = on;
    if (!on && this.deferred) { this.deferred = false; this.request(); }
  }

  /** 今すぐ合成する(書き終わりの確定など、ちらつかせたくないとき) */
  drawNow(): void {
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    this.draw();
  }

  private draw(): void {
    const doc = this.doc, ctx = this.bctx, v = this.view, d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = DESK; ctx.fillRect(0, 0, this.base.width, this.base.height);
    if (!doc) return;
    const k = levelFor(this.rs, d), tw = TILE / 2 ** k;
    const [wx0, wy0] = this.toWorld(0, 0), [wx1, wy1] = this.toWorld(this.W, this.H);
    // 表示位置はノートの近くに制限している(clampView)ので、その外のタイルは作らない
    const nb = noteBounds(doc.note), content: Box = [nb[0] - 800, nb[1] - 800, nb[2] + 800, nb[3] + 800];
    const tx0 = Math.floor(Math.max(wx0, content[0]) / tw), tx1 = Math.floor(Math.min(wx1, content[2]) / tw);
    const ty0 = Math.floor(Math.max(wy0, content[1]) / tw), ty1 = Math.floor(Math.min(wy1, content[3]) / tw);
    const t0 = performance.now(), now = ++this.clock;
    let pending = false;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = k + ':' + tx + ':' + ty;
      let t = this.tiles.get(key);
      const stale = !t || t.dirty || t.rs !== this.rs;
      // 編集された(dirty)タイルは必ず焼き直す。新規・倍率違いは時間の許す範囲で
      if (stale && (t?.dirty || performance.now() - t0 < FRAME_BUDGET_MS)) t = this.renderTile(key, k, tx, ty, t);
      else if (stale) pending = true;
      const sx = Math.round((tx * tw * v.s + v.x) * d), ex = Math.round(((tx + 1) * tw * v.s + v.x) * d);
      const sy = Math.round((ty * tw * v.s + v.y) * d), ey = Math.round(((ty + 1) * tw * v.s + v.y) * d);
      if (t) { t.used = now; ctx.drawImage(t.c, sx, sy, ex - sx, ey - sy); }
      else this.paperDirect(tx * tw, ty * tw, tw);
    }
    // 見えている分が済んだら、上下半画面ぶんを先に焼いておく(スクロールで白紙が見えないように)
    if (!pending && !this.prefetchTimer) {
      const half = Math.ceil((wy1 - wy0) / 2 / tw), rows: number[] = [];
      for (let i = 1; i <= half; i++) rows.push(ty1 + i, ty0 - i);
      let more = false;
      outer: for (const ty of rows) {
        if (ty * tw > content[3] || (ty + 1) * tw < content[1]) continue;
        for (let tx = tx0; tx <= tx1; tx++) {
          const key = k + ':' + tx + ':' + ty;
          let t = this.tiles.get(key);
          if (!t || t.dirty || t.rs !== this.rs) {
            if (performance.now() - t0 >= FRAME_BUDGET_MS) { more = true; break outer; }
            t = this.renderTile(key, k, tx, ty, t);
          }
          t.used = now;
        }
      }
      if (more) this.prefetchTimer = window.setTimeout(() => { this.prefetchTimer = 0; this.request(); }, 40);
    }
    this.evict(now);
    this.onOverlay();
    this.onViewChange();
    if (pending) this.request();
  }

  /** タイルが間に合わないとき、紙だけ直接描いておく */
  private paperDirect(x: number, y: number, tw: number): void {
    const ctx = this.bctx;
    ctx.save();
    this.setWorld(ctx);
    ctx.beginPath(); ctx.rect(x, y, tw, tw); ctx.clip();
    drawPaper(ctx, this.doc!.note, [x, y, x + tw, y + tw], 1 / (this.view.s * this.dpr));
    ctx.restore();
  }

  private renderTile(key: string, k: number, tx: number, ty: number, t?: Tile): Tile {
    const d = this.dpr, tw = TILE / 2 ** k, px = Math.round(tw * this.rs * d);
    if (!t || t.c.width !== px) {
      if (t) this.bytes -= t.bytes;
      const c = t?.c ?? document.createElement('canvas');
      c.width = c.height = px;
      t = { c, rs: this.rs, dirty: false, used: 0, bytes: px * px * 4 };
      this.bytes += t.bytes;
      this.tiles.set(key, t);
    }
    t.rs = this.rs; t.dirty = false;
    const ctx = t.c.getContext('2d', { alpha: false })!, f = px / tw;
    const area: Box = [tx * tw, ty * tw, (tx + 1) * tw, (ty + 1) * tw];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = DESK; ctx.fillRect(0, 0, px, px);
    ctx.setTransform(f, 0, 0, f, -area[0] * f, -area[1] * f);
    const doc = this.doc!;
    drawPaper(ctx, doc.note, area, 1 / f);
    const list = paintOrder(doc.query(area).filter(s => !doc.hidden.has(s.id)));
    for (const s of list) drawStroke(ctx, s);
    return t;
  }

  private evict(now: number): void {
    if (this.bytes <= CACHE_BYTES) return;
    const old = [...this.tiles].filter(([, t]) => t.used !== now).sort((a, b) => a[1].used - b[1].used);
    for (const [key, t] of old) {
      if (this.bytes <= CACHE_BYTES * 0.8) break;
      this.tiles.delete(key); this.bytes -= t.bytes;
      t.c.width = t.c.height = 0; // Safari はキャンバスのメモリを解放させるのに幅 0 が要る
    }
  }
}
