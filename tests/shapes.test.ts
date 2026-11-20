import { describe, expect, it } from 'vitest';
import { inferShape, shapePoints } from '../src/shapes';
const points = (f: (i: number) => [number, number], n = 80) => Float32Array.from(Array.from({ length: n }, (_, i) => [...f(i), 0.5]).flat());
describe('軌跡から図形を選ぶ', () => {
  it('少し揺れた斜線を直線と認識し、始点と今のペン先を結ぶ', () => {
    const P = points(i => [100 + i * 2, 150 + i * 0.6 + Math.sin(i) * 0.4]), shape = inferShape(P)!;
    expect(shape.kind).toBe('line');
    expect(Array.from(shapePoints(shape, P))).toEqual([P[0], P[1], P[2], ...P.slice(-3)]);
  });
  it('円と半円は円として認識し、動かしたペン先で半径を変えられる', () => {
    for (const turn of [Math.PI, 2 * Math.PI]) {
      const P = points(i => [180 + 40 * Math.cos(i / 79 * turn), 240 + 40 * Math.sin(i / 79 * turn)]);
      const shape = inferShape(P)!; expect(shape.kind).toBe('circle');
      if (shape.kind !== 'circle') throw new Error('circle expected');
      expect(shape.cx).toBeCloseTo(180, 3); expect(shape.cy).toBeCloseTo(240, 3);
      P[P.length - 3] = 240; P[P.length - 2] = 240;
      const Q = shapePoints(shape, P);
      expect(Array.from(Q.slice(0, 3))).toEqual(Array.from(Q.slice(-3)));
      for (let j = 0; j < Q.length; j += 3) expect(Math.hypot(Q[j] - 180, Q[j + 1] - 240)).toBeCloseTo(60, 3);
    }
  });
  it('点や短い線、文字のような折れを無理に図形にしない', () => {
    expect(inferShape(points(i => [i / 100, 0]))).toBeNull();
    expect(inferShape(points(i => [i * 2, 30 * Math.sin(i / 5)]))).toBeNull();
  });
  it('水平・垂直に近ければ軸にスナップし、斜線は残す', () => {
    const shape = { kind: 'line' as const, x: 10, y: 20 };
    expect(Array.from(shapePoints(shape, [10, 20, 0.5, 110, 25, 0.5]))).toEqual([10, 20, 0.5, 110, 20, 0.5]);
    expect(Array.from(shapePoints(shape, [10, 20, 0.5, 15, 120, 0.5]))).toEqual([10, 20, 0.5, 10, 120, 0.5]);
    expect(Array.from(shapePoints(shape, [10, 20, 0.5, 110, 120, 0.5]))).toEqual([10, 20, 0.5, 110, 120, 0.5]);
  });
});
