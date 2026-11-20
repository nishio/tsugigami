import { describe, expect, it } from 'vitest';
import {
  IDENTITY, apply, bboxOf, invert, isIdentity, lassoHit, matScale, mul, pointInPoly, rotateAt, scaleAt, strokeHit,
  strokeBox, transformStroke, translate,
} from '../src/geom';
import type { Stroke } from '../src/model';

const stroke = (pts: number[], width = 2): Stroke => {
  const P = Float32Array.from(pts.flatMap((v, i) => (i % 2 === 1 ? [v, 0.5] : [v])));
  return { id: 'a', noteId: 'n', kind: 'pen', color: '#000', width, pts: P, b: strokeBox({ pts: P, kind: 'pen', width }), z: 1 };
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

  it('投げ縄は一部でも内側に入る線を選ぶ', () => {
    const poly = [0, 0, 100, 0, 100, 100, 0, 100];
    const pb = bboxOf(poly, 2);
    expect(lassoHit(stroke([10, 10, 50, 50, 90, 90]), poly, pb)).toBe(true);
    expect(lassoHit(stroke([10, 10, 150, 50, 190, 90]), poly, pb)).toBe(true);
  });

  describe('投げ縄への接触', () => {
    const poly = [0, 0, 100, 0, 100, 100, 0, 100], pb = bboxOf(poly, 2);
    it.each([
      ['両端が外でも線分が横切る', [-50, 50, 150, 50], 2, true],
      ['閉じる辺にだけ触れる', [-50, 50, -1, 50], 2, true],
      ['線が境界に重なる', [20, 0, 80, 0], 0, true],
      ['角にだけ触れる', [-20, 20, 20, -20], 0, true],
      ['平行な線の太さだけが触れる', [20, -2, 80, -2], 4, true],
      ['平行な線に隙間がある', [20, -2.1, 80, -2.1], 4, false],
      ['丸い端だけが触れる', [-10, 50, -2, 50], 4, true],
      ['点が内側にある', [50, 50], 2, true],
      ['点が境界にある', [100, 50], 0, true],
      ['点の太さだけが触れる', [50, 102], 4, true],
      ['点が離れている', [50, 102.1], 4, false],
      ['外接矩形だけが重なる', [-10, 90, 10, 120], 2, false],
      ['同じ点が続く', [-2, 50, -2, 50], 4, true],
      ['投げ縄の周りを囲うだけでは触れない', [-10, -10, 110, -10, 110, 110, -10, 110, -10, -10], 2, false],
    ] as const)('%s', (_, pts, width, hit) => {
      const s = stroke([...pts], width);
      expect(lassoHit(s, poly, pb)).toBe(hit);
      expect(lassoHit(s, [0, 100, 100, 100, 100, 0, 0, 0], pb)).toBe(hit);
    });

    it('長い点列の短い接触も間引かずに拾う', () => {
      const pts = Array.from({ length: 131 }, () => [-10, 50]).flat();
      pts[258] = 1; // 以前の step=2 では調べない 129 番目の点
      expect(lassoHit(stroke(pts), poly, pb)).toBe(true);
    });

    it('マーカーの太さも接触に含める', () => {
      const s = { ...stroke([20, -10, 80, -10], 20), kind: 'marker' as const };
      expect(lassoHit(s, poly, pb)).toBe(true);
    });

    it('凹んだ投げ縄は外接矩形の内側でも触れていなければ選ばない', () => {
      const concave = [0, 0, 100, 0, 100, 20, 20, 20, 20, 100, 0, 100];
      expect(lassoHit(stroke([40, 50, 80, 50]), concave, pb)).toBe(false);
      expect(lassoHit(stroke([10, 50, 80, 50]), concave, pb)).toBe(true);
    });
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
