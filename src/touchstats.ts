// 手書きの軌跡は記録せず、タッチ 1 本ごとの特徴だけを端末内に保つ。
export const TOUCH_SAMPLE_LIMIT = 512;
export interface TouchPoint { id: number; t: number; x: number; y: number; width: number; height: number }
export interface TouchContext {
  viewport: [number, number]; pen: [number, number] | null; penActive: boolean; sincePenMs: number | null; decision: string;
}
export interface TouchSample {
  at: number; x: number; y: number; viewport: [number, number]; penOffset: [number, number] | null;
  penActive: boolean; sincePenMs: number | null; durationMs: number; movementPx: number;
  width: number; height: number; concurrent: number; cancelled: boolean; decision: string;
}
export interface TouchReport { format: 'tsugigami-touch-stats'; version: 1; total: number; samples: TouchSample[] }
interface Track { point: TouchPoint; sample: TouchSample }
export class TouchStats {
  enabled = false;
  onChange: () => void = () => {};
  private tracks = new Map<number, Track>();
  private samples: TouchSample[] = [];
  private total = 0;

  start(p: TouchPoint, c: TouchContext): void {
    if (!this.enabled) return;
    const [w, h] = c.viewport;
    const sample: TouchSample = {
      at: Date.now(), x: Math.round(p.x), y: Math.round(p.y), viewport: [w, h],
      penOffset: c.pen ? [Math.round(p.x - c.pen[0]), Math.round(p.y - c.pen[1])] : null,
      penActive: c.penActive, sincePenMs: c.sincePenMs == null ? null : Math.round(c.sincePenMs),
      durationMs: 0, movementPx: 0, width: p.width, height: p.height, concurrent: this.tracks.size + 1,
      cancelled: false, decision: c.decision,
    };
    this.tracks.set(p.id, { point: p, sample }); this.total++;
    for (const t of this.tracks.values()) t.sample.concurrent = Math.max(t.sample.concurrent, this.tracks.size);
  }
  move(p: TouchPoint): void {
    const tr = this.tracks.get(p.id);
    if (!tr) return;
    tr.sample.movementPx = Math.max(tr.sample.movementPx, Math.hypot(p.x - tr.point.x, p.y - tr.point.y));
    tr.sample.width = Math.max(tr.sample.width, p.width); tr.sample.height = Math.max(tr.sample.height, p.height);
  }
  mark(ids: Iterable<number>, decision: string): void {
    for (const id of ids) { const tr = this.tracks.get(id); if (tr) tr.sample.decision = decision; }
  }
  end(p: TouchPoint, cancelled: boolean): void {
    const tr = this.tracks.get(p.id);
    if (!tr) return;
    this.move(p); tr.sample.durationMs = Math.max(0, Math.round(p.t - tr.point.t));
    tr.sample.movementPx = Math.round(tr.sample.movementPx * 10) / 10;
    tr.sample.cancelled = cancelled;
    if (cancelled) tr.sample.decision = 'os-cancelled';
    this.samples.push(tr.sample); if (this.samples.length > TOUCH_SAMPLE_LIMIT) this.samples.shift();
    this.tracks.delete(p.id); this.onChange();
  }
  stop(): void { this.enabled = false; this.tracks.clear(); this.onChange(); }
  clear(): void { this.tracks.clear(); this.samples = []; this.total = 0; this.onChange(); }
  snapshot(): TouchReport {
    return structuredClone({ format: 'tsugigami-touch-stats', version: 1, total: this.total, samples: this.samples });
  }
  restore(report?: TouchReport): void {
    if (report?.format !== 'tsugigami-touch-stats' || report.version !== 1 || !Array.isArray(report.samples)) return;
    this.samples = structuredClone(report.samples.slice(-TOUCH_SAMPLE_LIMIT)); this.total = report.total;
  }
}
