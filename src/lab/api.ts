// 実験スクリプトに渡す `lab` オブジェクト。本物のアプリ(window.tsugigami)の上で、
// 合成のペン入力・画面の撮影・本物の Pencil の記録・人への指示をする。
import type { Controller } from '../controller';
import type { Doc } from '../doc';
import type { Renderer } from '../render';
import type { Store } from '../store';
import type { LabFile } from './repo';

/** main.ts が window.tsugigami に出しているもの */
export interface TsugigamiApp {
  readonly doc: Doc | null;
  r: Renderer;
  c: Controller;
  store: Store;
  openNote(id: string): Promise<void>;
  createNote(): Promise<void>;
}

export interface LabUI {
  say(text: string): void;
  ask(text: string): Promise<void>;
  log(line: string): void;
}

export interface Outputs {
  files: Map<string, LabFile>;
  log: string[];
}

export interface StrokeOptions {
  /** 'pen' か 'touch'。既定は pen */
  type?: 'pen' | 'touch';
  /** イベントの間隔(ms)。0 なら待たずに連続で送る。既定 4 */
  gap?: number;
  /** 1 回の move に何点まとめるか(2 点目以降は合体イベントの代わりに同じ move で送る)。既定 1 */
  batch?: number;
  pointerId?: number;
  pressure?: number;
  /** false なら pointerdown を送らない(前の stroke の続き)。既定 true */
  down?: boolean;
  /** false なら pointerup を送らない(ペンを置いたままにして撮るとき)。既定 true */
  up?: boolean;
}

export interface RecordedEvent {
  t: number; type: string; pt: string; id: number; x: number; y: number; p: number; buttons: number;
  /** 接地面の大きさ(CSS px)。手のひらと指を見分けられるかの材料 */
  w: number; h: number;
  /** 合体イベント(x, y, 筆圧, 時刻) */
  co?: number[][];
  /** 予測イベント(x, y) */
  pr?: number[][];
}

const sleep = (ms: number) => new Promise<void>(f => setTimeout(f, ms));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await new Promise(f => requestAnimationFrame(() => f(undefined))); };

export function makeLab(app: TsugigamiApp, stage: HTMLElement, ui: LabUI, out: Outputs) {
  const r = app.r;
  const rect = () => stage.getBoundingClientRect();

  /** ノート座標 → 画面(デバイス画素) */
  const devBox = (box?: number[]): [number, number, number, number] => {
    const d = r.dpr;
    if (!box) return [0, 0, r.base.width, r.base.height];
    const [ax, ay] = r.toScreen(box[0], box[1]), [bx, by] = r.toScreen(box[2], box[3]);
    const x0 = Math.max(0, Math.floor(ax * d)), y0 = Math.max(0, Math.floor(ay * d));
    const x1 = Math.min(r.base.width, Math.ceil(bx * d)), y1 = Math.min(r.base.height, Math.ceil(by * d));
    return [x0, y0, x1, y1];
  };

  const toPng = (c: HTMLCanvasElement) => new Promise<Uint8Array>((res, rej) => {
    c.toBlob(b => { if (!b) return rej(new Error('toBlob が失敗')); b.arrayBuffer().then(a => res(new Uint8Array(a))); }, 'image/png');
  });

  const save = (name: string, data: unknown): void => {
    if (data instanceof Uint8Array) out.files.set(name, { bytes: data });
    else if (typeof data === 'string') out.files.set(name, { text: data });
    else out.files.set(name, { text: JSON.stringify(data, null, 1) + '\n' });
  };

  const log = (...args: unknown[]): void => {
    const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    out.log.push(`${new Date().toISOString()} ${line}`);
    ui.log(line);
  };

  const lab = {
    app, sleep, frames, save, log,
    say: (text: string) => ui.say(text),
    ask: (text: string) => ui.ask(text),

    /** 端末と状態 */
    env() {
      const s = app.c.stats;
      return {
        ua: navigator.userAgent, dpr: r.dpr, screen: [screen.width, screen.height], stage: [r.W, r.H],
        view: { ...r.view }, rs: r.rs, lowLatency: r.lowLatency,
        stats: { ...s }, build: document.querySelector('#version')?.textContent ?? '',
        time: new Date().toISOString(),
      };
    },

    /** 新しいノートを作って開く(lab の保存領域。本物のノートには触らない) */
    async note(): Promise<string> {
      await app.createNote();
      await frames(2);
      return app.doc!.note.id;
    },

    /** 表示位置と倍率。x0, y0 がステージの左上に来る */
    async view(x0: number, y0: number, s = 1) {
      r.view = { s, x: -x0 * s, y: -y0 * s };
      r.clampView(); r.settle();
      await frames(2);
      return { ...r.view, rs: r.rs };
    },

    /** 合成のペン入力。pts はノート座標 [x, y] か [x, y, 筆圧]。終わったらペンを離すまで待つ */
    async stroke(pts: number[][], o: StrokeOptions = {}): Promise<void> {
      const type = o.type ?? 'pen', gap = o.gap ?? 4, batch = Math.max(1, o.batch ?? 1), id = o.pointerId ?? 7;
      const b = rect();
      const ev = (name: string, p: number[], buttons: number) => {
        const [sx, sy] = r.toScreen(p[0], p[1]);
        stage.dispatchEvent(new PointerEvent(name, {
          bubbles: true, cancelable: true, pointerId: id, pointerType: type, isPrimary: true,
          clientX: b.left + sx, clientY: b.top + sy, pressure: buttons ? (p[2] ?? o.pressure ?? 0.3) : 0, buttons,
        }));
      };
      let i = 0;
      if (o.down !== false) { ev('pointerdown', pts[0], 1); i = 1; }
      for (; i < pts.length; i += batch) {
        for (let j = i; j < Math.min(pts.length, i + batch); j++) ev('pointermove', pts[j], 1);
        if (gap > 0) await sleep(gap);
      }
      if (o.up !== false) ev('pointerup', pts[pts.length - 1], 0);
      await frames(2);
    },

    /** 画面(3 層を重ねたもの)を PNG に。box はノート座標 [x0, y0, x1, y1]、省略で全体。デバイス画素のまま */
    async shot(name: string, box?: number[]): Promise<{ w: number; h: number; box: number[] }> {
      await frames(1);
      const [x0, y0, x1, y1] = devBox(box), w = x1 - x0, h = y1 - y0;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(r.base, x0, y0, w, h, 0, 0, w, h);
      ctx.globalCompositeOperation = r.live.style.mixBlendMode === 'multiply' ? 'multiply' : 'source-over';
      ctx.drawImage(r.live, x0, y0, w, h, 0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(r.wet, x0, y0, w, h, 0, 0, w, h);
      save(name.endsWith('.png') ? name : name + '.png', await toPng(c));
      return { w, h, box: [x0, y0, x1, y1] };
    },

    /** 1 層だけ(base = タイル、live = 書いている線、wet = ペン先)。透明はそのまま */
    async layer(name: string, which: 'base' | 'live' | 'wet', box?: number[]): Promise<{ w: number; h: number }> {
      await frames(1);
      const [x0, y0, x1, y1] = devBox(box), w = x1 - x0, h = y1 - y0;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(r[which], x0, y0, w, h, 0, 0, w, h);
      save(name.endsWith('.png') ? name : name + '.png', await toPng(c));
      return { w, h };
    },

    /** 本物の入力を記録する。stop() で止めて配列を返す(座標はステージ内の CSS px) */
    record(): { stop(): RecordedEvent[]; events: RecordedEvent[] } {
      const events: RecordedEvent[] = [];
      const b = rect();
      const pick = (e: PointerEvent) => [e.clientX - b.left, e.clientY - b.top, e.pressure, e.timeStamp];
      const on = (e: Event) => {
        const p = e as PointerEvent;
        const rec: RecordedEvent = { t: p.timeStamp, type: p.type, pt: p.pointerType, id: p.pointerId, x: p.clientX - b.left, y: p.clientY - b.top, p: p.pressure, buttons: p.buttons, w: p.width, h: p.height };
        if (p.type === 'pointermove') {
          const co = p.getCoalescedEvents?.() ?? [], pr = p.getPredictedEvents?.() ?? [];
          if (co.length) rec.co = co.map(pick);
          if (pr.length) rec.pr = pr.map(c => [c.clientX - b.left, c.clientY - b.top]);
        }
        events.push(rec);
      };
      const names = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
      for (const n of names) window.addEventListener(n, on, true);
      return { events, stop: () => { for (const n of names) window.removeEventListener(n, on, true); return events; } };
    },

    /** 開いているノートの線(点列はそのまま) */
    strokes() {
      return [...(app.doc?.strokes.values() ?? [])].map(s => ({ id: s.id, kind: s.kind, color: s.color, width: s.width, z: s.z, b: s.b, pts: Array.from(s.pts) }));
    },
  };
  return lab;
}

export type Lab = ReturnType<typeof makeLab>;
