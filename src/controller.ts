// 入力の状態機械。ペン(とマウス)は道具として、指はスクロール・ズーム・取り消しのジェスチャーとして扱う。
import type { Doc } from './doc';
import {
  IDENTITY, type Mat, apply, bboxOf, isIdentity, lassoHit, mul, pointInPoly, rotateAt, scaleAt, strokeHit,
  transformStroke, translate, unionAll,
} from './geom';
import { type Box, type Stroke, type StrokeKind, newId, noteBounds, strokePad } from './model';
import { type Ink, type Renderer, drawMarker, drawPenSegments, drawPenTail, drawStroke, paintOrder } from './render';

export type Tool = 'pen' | 'marker' | 'eraser' | 'lasso';
export interface Brush { color: string; width: number }

/** ペンが触れている・近くにある・離れた直後のタッチは手のひらとみなす */
const PALM_MS = 500;
const ERASE_PX = 10;
const HANDLE_PX = 22;
const ROTATE_PX = 34;
const TAP_MS = 300;
const TAP_MOVE_PX = 16;
/** 2 本指タップの取り消しを実行するまでの猶予。その間にペンが触れたら手のひらだったとみなして取りやめる */
const TAP_DELAY_MS = 250;
const MIN_SCALE = 0.25, MAX_SCALE = 8;

/** 書き始めたときの文書を持つ(途中でノートが切り替わっても、書いた線は元のノートに入る) */
type Active = { id: number; doc: Doc } & (
  | { k: 'draw'; kind: StrokeKind; ink: Ink & { pts: number[] }; drawn: number }
  | { k: 'erase'; removed: Stroke[]; last: [number, number]; sp: [number, number] }
  | { k: 'lasso'; poly: number[] }
  | { k: 'xform'; mode: 'move' | 'scale' | 'rotate'; start: [number, number]; m0: Mat; pivot: [number, number] });

interface Selection { strokes: Stroke[]; box: Box; m: Mat }
interface GState { c: [number, number]; d: number; n: number }
interface Gesture { t0: number; moved: number; max: number; prev: GState; vx: number; vy: number; lastT: number }

const pres = (e: PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0) : 0.5);

export class Controller {
  tool: Tool = 'pen';
  pen: Brush = { color: '#1d2230', width: 2.2 };
  marker: Brush = { color: '#f4cf2a', width: 18 };
  sel: Selection | null = null;
  clipboard: Stroke[] = [];
  /** 取り消し可否や選択の有無など、UI に反映すべき状態が変わった */
  onState: () => void = () => {};
  /** 選択範囲の画面上の位置(メニューの配置用)。操作中や選択なしは null */
  onSelectionBox: (box: Box | null) => void = () => {};
  /** 初めてインクが置かれた(永続化の申請などに使う) */
  onInk: () => void = () => {};
  /** 計測用 */
  stats = { lastType: '—', pressure: 0, evRate: 0, ptRate: 0, lagMs: 0, palm: 0, hover: false, coalesced: false, predicted: false };

  private active: Active | null = null;
  private touches = new Map<number, [number, number]>();
  private ignored = new Set<number>();
  private gesture: Gesture | null = null;
  private lastPen = -1e9;
  private hover: [number, number] | null = null;
  private pred: number[][] | null = null;
  private momentum = 0;
  private tapTimer = 0;
  private rect = { left: 0, top: 0 };
  private strokeStat = { t0: 0, ev: 0, pt: 0, lag: 0, lagN: 0 };

  constructor(private stage: HTMLElement, private r: Renderer) {
    r.onOverlay = () => this.overlay();
    stage.addEventListener('pointerdown', e => this.onDown(e));
    // move / up は window で受ける。キャプチャが効かずにステージの外で離されても、書きかけのまま固まらないように
    window.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', e => this.onUp(e));
    window.addEventListener('pointercancel', e => this.onUp(e));
    stage.addEventListener('pointerleave', e => { if (!this.active && e.pointerType !== 'touch') { this.hover = null; this.renderWet(); } });
    stage.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    // iOS の長押しメニュー・ルーペ・ページズームを止める(Pointer Events は止まらない)
    for (const n of ['touchstart', 'touchmove']) stage.addEventListener(n, e => e.preventDefault(), { passive: false });
    stage.addEventListener('contextmenu', e => e.preventDefault());
  }

  get doc(): Doc | null { return this.r.doc; }
  get busy(): boolean { return !!this.active || !!this.gesture; }

  /** アプリが裏に回ったときなど: 指の状態を捨て、書きかけは確定させる */
  reset(): void {
    if (this.active) this.finish(this.active);
    this.touches.clear();
    this.ignored.clear();
    this.gesture = null;
    clearTimeout(this.tapTimer);
    this.stopMomentum();
  }

  updateRect(): void {
    const b = this.stage.getBoundingClientRect();
    this.rect = { left: b.left, top: b.top };
  }

  setTool(t: Tool): void {
    if (t !== 'lasso') this.clearSelection();
    this.tool = t;
    this.onState();
  }

  /** 色を選んだとき: 選択中ならその線の色を変える */
  setColor(kind: StrokeKind, color: string): void {
    (kind === 'pen' ? this.pen : this.marker).color = color;
    const sel = this.sel, doc = this.doc;
    if (sel && doc && sel.strokes.some(s => s.kind === kind && s.color !== color)) {
      this.commitTransform();
      const after = sel.strokes.map(s => (s.kind === kind ? { ...s, color } : s));
      doc.exec({ t: 'swap', before: sel.strokes, after });
      sel.strokes = after;
      this.r.request();
    } else {
      if (this.tool !== kind) this.setTool(kind);
    }
    this.onState();
  }

  // ---- 取り消し・クリップボード ----

  undo(): void {
    if (this.busy || !this.doc) return;
    this.clearSelection();
    if (this.doc.undo()) this.r.request();
    this.onState();
  }

  redo(): void {
    if (this.busy || !this.doc) return;
    this.clearSelection();
    if (this.doc.redo()) this.r.request();
    this.onState();
  }

  copy(): void {
    if (!this.sel) return;
    this.commitTransform();
    this.clipboard = this.sel.strokes.map(s => ({ ...s }));
    this.onState();
  }

  cut(): void { this.copy(); this.deleteSelection(); }

  deleteSelection(): void {
    const sel = this.sel, doc = this.doc;
    if (!sel || !doc) return;
    this.commitTransform();
    const list = this.sel!.strokes;
    this.clearSelection();
    doc.exec({ t: 'del', s: list });
    this.onState();
  }

  duplicate(): void {
    if (!this.sel) return;
    this.commitTransform();
    const off = 24 / this.r.view.s;
    this.place(this.sel.strokes, translate(off, off));
  }

  /** クリップボードの線を画面の中央に貼る */
  paste(): void {
    if (!this.clipboard.length) return;
    const b = unionAll(this.clipboard.map(s => s.b))!;
    const [cx, cy] = this.r.toWorld(this.r.W / 2, this.r.H / 2);
    this.place(this.clipboard, translate(cx - (b[0] + b[2]) / 2, cy - (b[1] + b[3]) / 2));
  }

  private place(src: Stroke[], m: Mat): void {
    const doc = this.doc;
    if (!doc) return;
    this.clearSelection();
    const list = paintOrder([...src]).map(s => ({ ...transformStroke(s, m), id: newId(), noteId: doc.note.id, z: doc.nextZ() }));
    doc.exec({ t: 'add', s: list });
    this.select(list);
    if (this.tool !== 'lasso') { this.tool = 'lasso'; }
    this.onInk();
    this.onState();
  }

  // ---- 選択 ----

  private select(list: Stroke[]): void {
    const doc = this.doc!;
    this.sel = { strokes: list, box: unionAll(list.map(s => s.b))!, m: IDENTITY };
    doc.hidden.clear();
    for (const s of list) doc.hidden.add(s.id);
    this.r.invalidate(this.sel.box);
    this.onState();
  }

  clearSelection(): void {
    const sel = this.sel, doc = this.doc;
    if (!sel) return;
    this.commitTransform();
    this.sel = null;
    if (doc) {
      doc.hidden.clear();
      this.r.invalidate(sel.box);
    }
    this.onSelectionBox(null);
    this.onState();
  }

  /** 変形中の見た目を確定してストロークに書き戻す */
  private commitTransform(): void {
    const sel = this.sel, doc = this.doc;
    if (!sel || !doc || isIdentity(sel.m)) return;
    const after = sel.strokes.map(s => transformStroke(s, sel.m));
    doc.exec({ t: 'swap', before: sel.strokes, after });
    sel.strokes = after;
    sel.box = unionAll(after.map(s => s.b))!;
    sel.m = IDENTITY;
  }

  /** 選択枠の四隅(ノート座標、変形込み)。左上・右上・右下・左下 */
  private corners(): [number, number][] {
    const s = this.sel!, b = s.box;
    return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, y]) => apply(s.m, x, y));
  }

  private rotateHandle(): [number, number] {
    const c = this.corners().map(p => this.r.toScreen(...p));
    const top: [number, number] = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
    const mid: [number, number] = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
    const dx = top[0] - mid[0], dy = top[1] - mid[1], L = Math.hypot(dx, dy) || 1;
    return [top[0] + (dx / L) * ROTATE_PX, top[1] + (dy / L) * ROTATE_PX];
  }

  private hitSelection(sp: [number, number]): { mode: 'move' | 'scale' | 'rotate'; pivot: [number, number] } | null {
    const cw = this.corners(), cs = cw.map(p => this.r.toScreen(...p));
    const near = (p: [number, number]) => Math.hypot(p[0] - sp[0], p[1] - sp[1]) < HANDLE_PX;
    const center: [number, number] = [(cw[0][0] + cw[2][0]) / 2, (cw[0][1] + cw[2][1]) / 2];
    if (near(this.rotateHandle())) return { mode: 'rotate', pivot: center };
    for (let i = 0; i < 4; i++) if (near(cs[i])) return { mode: 'scale', pivot: cw[(i + 2) % 4] };
    // 枠の内側(小さすぎる選択は少し広げて掴みやすく)
    const pad = 12;
    const poly = cs.flatMap(p => p);
    if (pointInPoly(sp[0], sp[1], poly)) return { mode: 'move', pivot: center };
    const bb = bboxOf(poly, 2, pad);
    if (sp[0] >= bb[0] && sp[0] <= bb[2] && sp[1] >= bb[1] && sp[1] <= bb[3] && (bb[2] - bb[0] < 60 || bb[3] - bb[1] < 60)) return { mode: 'move', pivot: center };
    return null;
  }

  // ---- 重ね描き(ライブ層とつまみ層) ----

  private overlay(): void {
    const r = this.r, a = this.active;
    r.clear(r.lctx);
    if (a?.k === 'draw') {
      r.setWorld(r.lctx);
      if (a.kind === 'marker') drawMarker(r.lctx, a.ink); else drawPenSegments(r.lctx, a.ink);
    } else if (this.sel) {
      r.setWorld(r.lctx, this.sel.m);
      for (const s of paintOrder([...this.sel.strokes])) drawStroke(r.lctx, s);
    }
    this.renderWet();
    if (this.sel && a?.k !== 'xform') {
      const cs = this.corners().map(p => r.toScreen(...p)), xs = cs.map(p => p[0]), ys = cs.map(p => p[1]);
      this.onSelectionBox([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    } else this.onSelectionBox(null);
  }

  private renderWet(): void {
    const r = this.r, ctx = r.wctx, a = this.active;
    r.clear(ctx);
    if (a?.k === 'draw' && a.kind === 'pen') {
      r.setWorld(ctx);
      drawPenTail(ctx, a.ink, this.pred ?? undefined);
    }
    if (a?.k === 'lasso' && a.poly.length >= 4) {
      r.setWorld(ctx);
      ctx.lineWidth = 1.5 / r.view.s; ctx.setLineDash([6 / r.view.s, 5 / r.view.s]); ctx.strokeStyle = '#3b63d6';
      ctx.fillStyle = 'rgba(59, 99, 214, 0.06)';
      ctx.beginPath(); ctx.moveTo(a.poly[0], a.poly[1]);
      for (let i = 2; i < a.poly.length; i += 2) ctx.lineTo(a.poly[i], a.poly[i + 1]);
      ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
    const d = r.dpr;
    if (this.sel) {
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const cs = this.corners().map(p => r.toScreen(...p)), rh = this.rotateHandle();
      ctx.strokeStyle = '#3b63d6'; ctx.lineWidth = 1.25; ctx.setLineDash([5, 4]);
      ctx.beginPath(); cs.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
      const top = [(cs[0][0] + cs[1][0]) / 2, (cs[0][1] + cs[1][1]) / 2];
      ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(rh[0], rh[1]); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (const p of [...cs, rh]) { ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    const cur = a?.k === 'erase' ? a.sp : !a ? this.hover : null;
    if (cur) {
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const rad = this.tool === 'eraser' ? ERASE_PX : this.tool === 'lasso' ? 3 : Math.max(1.5, ((this.tool === 'marker' ? this.marker.width : this.pen.width) * r.view.s) / 2);
      ctx.strokeStyle = 'rgba(40, 44, 52, 0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cur[0], cur[1], rad, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ---- Pointer Events ----

  private pt(e: { clientX: number; clientY: number }): [number, number] {
    return [e.clientX - this.rect.left, e.clientY - this.rect.top];
  }

  private capture(e: PointerEvent): void {
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* 合成イベントなど */ }
  }

  private onDown(e: PointerEvent): void {
    const t = e.pointerType, now = performance.now();
    this.stopMomentum();
    if (t === 'pen') { this.lastPen = now; if (this.gesture) this.cancelGesture(); clearTimeout(this.tapTimer); }
    // 離したイベントを取りこぼして書きかけが残っていたら、ここで確定させる(固まらないように)
    if (t !== 'touch' && this.active && this.active.id !== e.pointerId) this.finish(this.active);
    if (t === 'touch') {
      if (this.active || now - this.lastPen < PALM_MS) { this.ignored.add(e.pointerId); this.stats.palm++; return; }
      this.touches.set(e.pointerId, this.pt(e));
      this.capture(e);
      this.gestureReset();
      return;
    }
    if (t === 'mouse' && e.button !== 0) return;
    const doc = this.doc;
    if (this.active || !doc) return;
    this.capture(e);
    const sp = this.pt(e), [x, y] = this.r.toWorld(...sp);
    this.hover = null;
    this.strokeStat = { t0: now, ev: 0, pt: 0, lag: 0, lagN: 0 };
    this.stats.lastType = t;
    if (this.sel) {
      const h = this.hitSelection(sp);
      if (h) {
        this.active = { k: 'xform', id: e.pointerId, doc, mode: h.mode, start: [x, y], m0: this.sel.m, pivot: h.pivot };
        this.overlay();
        return;
      }
      this.clearSelection();
    }
    switch (this.tool) {
      case 'pen': case 'marker': {
        const b = this.tool === 'pen' ? this.pen : this.marker;
        this.active = { k: 'draw', id: e.pointerId, doc, kind: this.tool, ink: { pts: [x, y, pres(e)], width: b.width, color: b.color }, drawn: 1 };
        this.pred = null;
        this.r.hold(true);
        this.overlay();
        break;
      }
      case 'eraser':
        this.active = { k: 'erase', id: e.pointerId, doc, removed: [], last: [x, y], sp };
        this.eraseTo(x, y);
        this.renderWet();
        break;
      case 'lasso':
        this.active = { k: 'lasso', id: e.pointerId, doc, poly: [x, y] };
        this.r.hold(true);
        break;
    }
  }

  private onMove(e: PointerEvent): void {
    const t = e.pointerType;
    if (t === 'pen') { this.lastPen = performance.now(); this.stats.pressure = e.pressure; }
    if (this.touches.has(e.pointerId)) { this.touches.set(e.pointerId, this.pt(e)); this.gestureMove(); return; }
    const a = this.active;
    if (!a || e.pointerId !== a.id) {
      if (t !== 'touch' && e.buttons === 0 && e.target instanceof Node && this.stage.contains(e.target)) {
        if (t === 'pen') this.stats.hover = true;
        this.hover = this.pt(e);
        this.renderWet();
      }
      return;
    }
    const st = this.strokeStat, lag = performance.now() - e.timeStamp;
    if (lag >= 0 && lag < 1000) { st.lag += lag; st.lagN++; }
    const co = e.getCoalescedEvents?.() ?? [];
    if (co.length) this.stats.coalesced = true;
    const list = co.length ? co : [e];
    st.ev++; st.pt += list.length;
    const r = this.r;
    switch (a.k) {
      case 'draw': {
        const P = a.ink.pts, eps = 0.3 / r.view.s;
        for (const ev of list) {
          const [x, y] = r.toWorld(...this.pt(ev)), j = P.length - 3;
          if (Math.abs(x - P[j]) + Math.abs(y - P[j + 1]) < eps) continue;
          P.push(x, y, pres(ev));
        }
        this.pred = null;
        if (a.kind === 'pen' && e.getPredictedEvents) {
          const pe = e.getPredictedEvents();
          if (pe.length) { this.stats.predicted = true; this.pred = pe.map(ev => r.toWorld(...this.pt(ev))); }
        }
        const ctx = r.lctx, n = P.length / 3;
        if (a.kind === 'marker') { r.clear(ctx); r.setWorld(ctx); drawMarker(ctx, a.ink); }
        else if (n > a.drawn) { r.setWorld(ctx); drawPenSegments(ctx, a.ink, a.drawn); a.drawn = n; }
        this.renderWet();
        break;
      }
      case 'erase':
        for (const ev of list) this.eraseTo(...r.toWorld(...this.pt(ev)));
        a.sp = this.pt(e);
        this.renderWet();
        break;
      case 'lasso': {
        const [x, y] = r.toWorld(...this.pt(e)), j = a.poly.length - 2;
        if (Math.hypot(x - a.poly[j], y - a.poly[j + 1]) * r.view.s > 3) a.poly.push(x, y);
        this.renderWet();
        break;
      }
      case 'xform': {
        const [x, y] = r.toWorld(...this.pt(e)), [sx, sy] = a.start, [px, py] = a.pivot, sel = this.sel!;
        if (a.mode === 'move') {
          // 選択の中心がノートの外へ出ないようにする(出ると見えず、選び直せなくなる)
          const b = sel.box, [cx, cy] = apply(a.m0, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2), nb = noteBounds(a.doc.note);
          const dx = Math.min(nb[2], Math.max(nb[0], cx + x - sx)) - cx, dy = Math.min(nb[3], Math.max(nb[1], cy + y - sy)) - cy;
          sel.m = mul(translate(dx, dy), a.m0);
        } else if (a.mode === 'scale') {
          const f = Math.min(8, Math.max(0.05, Math.hypot(x - px, y - py) / (Math.hypot(sx - px, sy - py) || 1)));
          sel.m = mul(scaleAt(f, px, py), a.m0);
        } else {
          const th = Math.atan2(y - py, x - px) - Math.atan2(sy - py, sx - px);
          sel.m = mul(rotateAt(th, px, py), a.m0);
        }
        this.overlay();
        break;
      }
    }
  }

  private onUp(e: PointerEvent): void {
    const id = e.pointerId;
    if (e.pointerType === 'pen') this.lastPen = performance.now();
    if (this.ignored.delete(id)) return;
    if (this.touches.has(id)) { this.touches.delete(id); this.gestureLift(); return; }
    const a = this.active;
    if (!a || id !== a.id) return;
    this.finish(a);
  }

  /** 書く・消す・投げ縄・変形を終える */
  private finish(a: Active): void {
    const doc = a.doc;
    this.active = null;
    this.pred = null;
    this.r.hold(false);
    const st = this.strokeStat, dur = (performance.now() - st.t0) / 1000;
    if (dur > 0.15 && st.ev) { this.stats.evRate = st.ev / dur; this.stats.ptRate = st.pt / dur; }
    if (st.lagN) this.stats.lagMs = st.lag / st.lagN;
    switch (a.k) {
      case 'draw': {
        const pts = Float32Array.from(a.ink.pts);
        const s: Stroke = {
          id: newId(), noteId: doc.note.id, kind: a.kind, color: a.ink.color, width: a.ink.width, pts,
          b: bboxOf(pts, 3, strokePad(a.kind, a.ink.width)), z: doc.nextZ(),
        };
        doc.exec({ t: 'add', s: [s] });
        // タイルを焼き直してからライブ層を消す(ちらつかせない)
        if (doc === this.doc) this.r.drawNow(true);
        this.onInk();
        break;
      }
      case 'erase':
        if (a.removed.length) doc.record({ t: 'del', s: a.removed });
        break;
      case 'lasso': {
        const poly = a.poly;
        if (poly.length >= 6) {
          const pb = bboxOf(poly, 2);
          const hits = doc.query(pb).filter(s => lassoHit(s, poly, pb));
          if (hits.length) this.select(hits);
        }
        break;
      }
      case 'xform':
        this.commitTransform();
        this.r.request();
        break;
    }
    this.overlay();
    this.onState();
  }

  private eraseTo(x: number, y: number): void {
    const a = this.active;
    if (a?.k !== 'erase') return;
    const doc = a.doc;
    const rad = ERASE_PX / this.r.view.s, [lx, ly] = a.last;
    const steps = Math.max(1, Math.ceil(Math.hypot(x - lx, y - ly) / rad));
    for (let i = 1; i <= steps; i++) {
      const px = lx + ((x - lx) * i) / steps, py = ly + ((y - ly) * i) / steps;
      const hits = doc.query([px - rad, py - rad, px + rad, py + rad]).filter(s => strokeHit(s, px, py, rad));
      if (hits.length) { doc.apply({ t: 'del', s: hits }); a.removed.push(...hits); }
    }
    a.last = [x, y];
  }

  // ---- 指: スクロール・ズーム・タップ ----

  private gState(): GState {
    const a = [...this.touches.values()].slice(0, 2);
    if (a.length === 1) return { c: a[0], d: 0, n: 1 };
    return { c: [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2], d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), n: 2 };
  }

  private gestureReset(): void {
    if (!this.gesture) this.gesture = { t0: performance.now(), moved: 0, max: 0, prev: this.gState(), vx: 0, vy: 0, lastT: performance.now() };
    this.gesture.max = Math.max(this.gesture.max, this.touches.size);
    this.gesture.prev = this.gState();
  }

  private gestureMove(): void {
    const g = this.gesture;
    if (!g) return;
    const n = this.gState(), p = g.prev, v = this.r.view, now = performance.now();
    if (n.n !== p.n) { g.prev = n; return; }
    const dx = n.c[0] - p.c[0], dy = n.c[1] - p.c[1];
    v.x += dx; v.y += dy;
    if (n.n === 2 && p.d > 0) {
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (v.s * n.d) / p.d)), f = ns / v.s;
      v.x = n.c[0] - (n.c[0] - v.x) * f; v.y = n.c[1] - (n.c[1] - v.y) * f; v.s = ns;
    }
    // 速度(px/ms)。イベントの間隔が極端に短いと跳ねるので、間隔に下限、速度に上限を付ける
    const dt = Math.max(8, now - g.lastT), cap = (u: number) => Math.max(-4, Math.min(4, u));
    g.vx = cap(g.vx * 0.6 + (dx / dt) * 0.4); g.vy = cap(g.vy * 0.6 + (dy / dt) * 0.4); g.lastT = now;
    g.moved += Math.abs(dx) + Math.abs(dy) + Math.abs(n.d - p.d);
    g.prev = n;
    this.r.clampView();
    this.r.request();
  }

  private gestureLift(): void {
    const g = this.gesture;
    if (!g) return;
    if (this.touches.size) { g.prev = this.gState(); return; }
    this.gesture = null;
    const now = performance.now();
    if (now - g.t0 < TAP_MS && g.moved < TAP_MOVE_PX) {
      clearTimeout(this.tapTimer);
      this.tapTimer = window.setTimeout(() => { if (g.max === 2) this.undo(); else if (g.max === 3) this.redo(); }, TAP_DELAY_MS);
      return;
    }
    if (g.max === 1 && now - g.lastT < 60 && Math.hypot(g.vx, g.vy) > 0.25) this.startMomentum(g.vx, g.vy);
    else this.r.settle();
  }

  private cancelGesture(): void {
    for (const id of this.touches.keys()) this.ignored.add(id);
    this.touches.clear();
    this.gesture = null;
    this.r.settle();
  }

  private startMomentum(vx: number, vy: number): void {
    let last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(32, t - last); last = t;
      const v = this.r.view, ox = v.x, oy = v.y;
      v.x += vx * dt; v.y += vy * dt;
      this.r.clampView();
      const k = Math.pow(0.95, dt / 16);
      vx = v.x === ox ? 0 : vx * k; vy = v.y === oy ? 0 : vy * k;
      this.r.request();
      if (Math.hypot(vx, vy) < 0.03) { this.momentum = 0; this.r.settle(); return; }
      this.momentum = requestAnimationFrame(step);
    };
    this.momentum = requestAnimationFrame(step);
  }

  private stopMomentum(): void {
    if (!this.momentum) return;
    cancelAnimationFrame(this.momentum);
    this.momentum = 0;
    this.r.settle();
  }

  private wheelTimer = 0;
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const v = this.r.view, [sx, sy] = this.pt(e);
    if (e.ctrlKey) {
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s * Math.exp(-e.deltaY * 0.01))), f = ns / v.s;
      v.x = sx - (sx - v.x) * f; v.y = sy - (sy - v.y) * f; v.s = ns;
    } else { v.x -= e.deltaX; v.y -= e.deltaY; }
    this.r.clampView();
    this.r.request();
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => this.r.settle(), 150);
  }
}
