import { describe, expect, it } from 'vitest';
import {
  IDENTITY, apply, bboxOf, invert, isIdentity, lassoHit, matScale, mul, pointInPoly, rotateAt, scaleAt, strokeHit,
  transformStroke, translate,
} from '../src/geom';
import type { Stroke } from '../src/model';

const stroke = (pts: number[], width = 2): Stroke => {
  const P = Float32Array.from(pts.flatMap((v, i) => (i % 2 === 1 ? [v, 0.5] : [v])));
  return { id: 'a', noteId: 'n', kind: 'pen', color: '#000', width, pts: P, b: bboxOf(P, 3, width), z: 1 };
};

describe('geom', () => {
  it('消しゴムは線分の途中にも当たる', () => {
    const s = stroke([0, 0, 100, 0]);
    expect(strokeHit(s, 50, 3, 2)).toBe(true);
    expect(strokeHit(s, 50, 10, 2)).toBe(false);
    expect(strokeHit(s, 150, 0, 2)).toBe(false);
  });

  it('点だけの線にも当たる', () => {
    expect(strokeHit(stroke([10, 10]), 11, 11, 2)).toBe(true);
  });

  it('多角形の内外判定', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPoly(5, 5, sq)).toBe(true);
    expect(pointInPoly(15, 5, sq)).toBe(false);
  });

  it('投げ縄は点の半分以上が内側の線を選ぶ', () => {
    const poly = [0, 0, 100, 0, 100, 100, 0, 100];
    const pb = bboxOf(poly, 2);
    expect(lassoHit(stroke([10, 10, 50, 50, 90, 90]), poly, pb)).toBe(true);
    expect(lassoHit(stroke([10, 10, 150, 50, 190, 90]), poly, pb)).toBe(false);
  });

  it('変換の合成と逆変換', () => {
    const m = mul(translate(10, 5), mul(rotateAt(0.7, 3, 4), scaleAt(2, 1, 1)));
    const [x, y] = apply(m, 7, -2);
    const [bx, by] = apply(invert(m), x, y);
    expect(bx).toBeCloseTo(7); expect(by).toBeCloseTo(-2);
    expect(matScale(m)).toBeCloseTo(2);
    expect(isIdentity(mul(m, invert(m)))).toBe(true);
    expect(isIdentity(IDENTITY)).toBe(true);
  });

  it('回転は中心を動かさない', () => {
    const [x, y] = apply(rotateAt(1.2, 50, 60), 50, 60);
    expect(x).toBeCloseTo(50); expect(y).toBeCloseTo(60);
  });

  it('変形したストロークは太さも拡大され、外接矩形が更新される', () => {
    const s = stroke([0, 0, 10, 0]);
    const t = transformStroke(s, scaleAt(3, 0, 0));
    expect(t.width).toBeCloseTo(6);
    expect(t.pts[3]).toBeCloseTo(30);
    expect(t.b[2]).toBeGreaterThan(30);
    expect(s.pts[3]).toBe(10); // 元は変わらない
  });
});
