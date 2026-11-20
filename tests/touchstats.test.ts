import { describe, expect, it } from 'vitest';
import { TOUCH_SAMPLE_LIMIT, TouchStats, type TouchContext } from '../src/touchstats';

const context: TouchContext = { viewport: [800, 1100], pen: [300, 400], penActive: true, sincePenMs: 0, decision: 'pen-active' };
const point = (id = 1, t = 0, x = 400, y = 600) => ({ id, t, x, y, width: 5, height: 7 });
describe('touch statistics', () => {
  it('有効にした間だけ位置・筆先との関係・接触の長さ・同時点数を取る', () => {
    const stats = new TouchStats(); stats.start(point(), context); stats.end(point(1, 30), false);
    expect(stats.snapshot().samples).toHaveLength(0);
    stats.enabled = true; stats.start(point(), context); stats.start(point(2, 10), context);
    stats.move(point(1, 20, 403, 604)); stats.end(point(1, 50), true); stats.end(point(2, 75), false);
    const [s] = stats.snapshot().samples;
    expect(s).toMatchObject({ x: 400, y: 600, penOffset: [100, 200], movementPx: 5, durationMs: 50, concurrent: 2, cancelled: true, decision: 'os-cancelled' });
    expect(stats.snapshot().total).toBe(2);
  });
  it('長時間使っても直近 512 接触だけを保ち、書き出した配列から内部を変えられない', () => {
    const stats = new TouchStats(); stats.enabled = true;
    for (let i = 0; i < 600; i++) { stats.start(point(i, i * 10), context); stats.end(point(i, i * 10 + 5), false); }
    const report = stats.snapshot(); expect(report.total).toBe(600); expect(report.samples).toHaveLength(TOUCH_SAMPLE_LIMIT);
    report.samples.length = 0; expect(stats.snapshot().samples).toHaveLength(TOUCH_SAMPLE_LIMIT);
    const next = new TouchStats(); next.restore(stats.snapshot()); expect(next.snapshot()).toEqual(stats.snapshot());
    next.clear(); expect(next.snapshot().total).toBe(0); expect(next.snapshot().samples).toHaveLength(0);
  });
});
