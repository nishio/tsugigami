import { describe, expect, it } from 'vitest';
import recorded from '../raw/tsugigami-20261028-1535.json?raw';
import { SMOOTH_SIGMA, dropReplays, latticeStep, renderPts, smoothPts } from '../src/smooth';

/** 決まった乱数(テストを毎回同じにする) */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

/**
 * 真の曲線 f(弧長) を 0.2〜1.0 px 間隔で取り、間隔 q の格子に丸める(iPad の Safari と同じ)。
 * 丸めて同じ点になったものは捨てる(controller の onMove と同じ)。
 */
function quantized(f: (s: number) => [number, number], L: number, q: number, seed = 1, y0 = 0): { P: Float32Array; f: typeof f } {
  const r = rng(seed), ox = r() * q, oy = r() * q, out: number[] = [];
  for (let s = 0; s <= L; s += 0.2 + 0.8 * r()) {
    const [x, y] = f(s);
    const X = Math.round((x - ox) / q) * q + ox, Y = Math.round((y + y0 - oy) / q) * q + oy;
    const j = out.length - 3;
    if (j >= 0 && out[j] === X && out[j + 1] === Y) continue;
    out.push(X, Y, 0.3);
  }
  return { P: Float32Array.from(out), f: (s: number) => { const [x, y] = f(s); return [x, y + y0]; } };
}

/** 点から真の曲線までの距離(曲線は細かく取った折れ線で近似) */
function deviation(P: ArrayLike<number>, f: (s: number) => [number, number], L: number): { rms: number; max: number } {
  const T: [number, number][] = [];
  for (let s = 0; s <= L; s += L / 2000) T.push(f(s));
  let sum = 0, max = 0, n = 0;
  for (let j = 0; j < P.length; j += 3) {
    let best = Infinity;
    for (const [x, y] of T) best = Math.min(best, (P[j] - x) ** 2 + (P[j + 1] - y) ** 2);
    const d = Math.sqrt(best);
    sum += d * d; max = Math.max(max, d); n++;
  }
  return { rms: Math.sqrt(sum / n), max };
}

/** 折れの大きさ: 弧長 q ごとに取り直した折れ線の、向きの変化の RMS(度) */
function jaggedness(P: ArrayLike<number>, q: number): number {
  const s = [0];
  for (let j = 3; j < P.length; j += 3) s.push(s[s.length - 1] + Math.hypot(P[j] - P[j - 3], P[j + 1] - P[j - 2]));
  const R: [number, number][] = [];
  for (let t = 0, i = 0; t <= s[s.length - 1]; t += q) {
    while (i + 1 < s.length - 1 && s[i + 1] < t) i++;
    const u = (t - s[i]) / (s[i + 1] - s[i] || 1);
    R.push([P[i * 3] + u * (P[i * 3 + 3] - P[i * 3]), P[i * 3 + 1] + u * (P[i * 3 + 4] - P[i * 3 + 1])]);
  }
  const a: number[] = [];
  for (let i = 1; i < R.length; i++) a.push(Math.atan2(R[i][1] - R[i - 1][1], R[i][0] - R[i - 1][0]));
  let sum = 0;
  for (let i = 1; i < a.length; i++) { let d = a[i] - a[i - 1]; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; sum += d * d; }
  return (Math.sqrt(sum / (a.length - 1)) * 180) / Math.PI;
}

const q = 0.42; // 実機の記録で見つかった間隔(倍率 1.19、dpr 2)

describe('latticeStep', () => {
  it('格子に丸めた点列から間隔を見つける', () => {
    const { P } = quantized(s => [s, 0.15 * s], 30, q);
    expect(latticeStep(P)).toBeCloseTo(q, 3);
  });

  it('ノートの下の方(y が大きく、Float32 の丸めが粗い)でも見つける', () => {
    const { P } = quantized(s => [5 * Math.cos(s / 5), 5 * Math.sin(s / 5)], 30, q, 2, 80000);
    expect(Math.abs(latticeStep(P) - q)).toBeLessThan(0.02 * q);
  });

  it('拡大して書いた線(間隔が細かい)', () => {
    const { P } = quantized(s => [s, 0.3 * s], 10, 1 / 16);
    expect(latticeStep(P)).toBeCloseTo(1 / 16, 3);
  });

  it('格子に揃っていない点列は 0', () => {
    const r = rng(5), P: number[] = [];
    for (let i = 0; i < 50; i++) P.push(i * 0.7 + r() * 0.3, Math.sin(i / 5) * 3 + r() * 0.3, 0.3);
    expect(latticeStep(P)).toBe(0);
  });

  it('点が少ないと 0', () => {
    expect(latticeStep([0, 0, 0.3, 0.42, 0, 0.3])).toBe(0);
  });
});

describe('smoothPts', () => {
  const sigma = q * SMOOTH_SIGMA;

  it('水平に近い線の階段をならす(拡大したときのガタつき)', () => {
    for (const slope of [0.03, 0.15]) {
      const f = (s: number): [number, number] => [s / Math.hypot(1, slope), (s * slope) / Math.hypot(1, slope)];
      const { P } = quantized(f, 12, q, 3);
      const S = smoothPts(P, sigma);
      expect(jaggedness(S, q)).toBeLessThan(jaggedness(P, q) / 2);
      expect(deviation(S, f, 12).rms).toBeLessThan(deviation(P, f, 12).rms);
    }
  });

  it('小さな円を縮めない', () => {
    const R = 5, f = (s: number): [number, number] => [R * Math.cos(s / R), R * Math.sin(s / R)];
    const { P } = quantized(f, 2 * Math.PI * R, q, 4);
    const S = smoothPts(P, sigma);
    let sum = 0;
    for (let j = 0; j < S.length; j += 3) sum += Math.hypot(S[j], S[j + 1]);
    expect(Math.abs(sum / (S.length / 3) - R)).toBeLessThan(0.1 * q);
    expect(jaggedness(S, q)).toBeLessThan(jaggedness(P, q) / 2);
  });

  it('線の端を引っ込めない、角を丸めすぎない', () => {
    const f = (s: number): [number, number] => (s < 15 ? [s, 0] : [15, s - 15]);
    const { P } = quantized(f, 30, q, 6);
    const S = smoothPts(P, sigma), n = S.length;
    expect(Math.hypot(S[0] - P[0], S[1] - P[1])).toBeLessThan(q);
    expect(Math.hypot(S[n - 3] - P[n - 3], S[n - 2] - P[n - 2])).toBeLessThan(q);
    expect(deviation(S, f, 30).max).toBeLessThan(1.5 * q);
  });

  it('筆圧はそのまま、点の数も変えない', () => {
    const { P } = quantized(s => [s, 0.1 * s], 10, q);
    P[5] = 0.9;
    const S = smoothPts(P, sigma);
    expect(S.length).toBe(P.length);
    expect(S[5]).toBeCloseTo(0.9);
  });

  it('2 点以下の線と幅 0 はそのまま', () => {
    expect(Array.from(smoothPts([1, 2, 0.3, 3, 4, 0.3], sigma))).toEqual([1, 2, expect.closeTo(0.3), 3, 4, expect.closeTo(0.3)]);
    const { P } = quantized(s => [s, 0], 5, q);
    expect(Array.from(smoothPts(P, 0))).toEqual(Array.from(P));
  });
});

describe('dropReplays', () => {
  const pts = (...xy: number[]) => Float32Array.from(xy.flatMap((v, i) => (i % 2 ? [v, 0.3] : [v])));

  it('直前の数点をそっくり繰り返した所を除く(Safari が同じ pointermove を 2 回届けたもの)', () => {
    // 実機の記録(z=102)の形: …, -1, 1, [-1, 1], 3, 5, [3, 5], 8, 11, [8, 11]
    const P = pts(0, 0, 1, 0, 2, 0, 1, 0, 2, 0, 3, 0, 5, 0, 3, 0, 5, 0, 8, 0);
    expect(Array.from(dropReplays(P)).filter((_, i) => i % 3 === 0)).toEqual([0, 1, 2, 3, 5, 8]);
  });

  it('行って戻る線(1 点ずつの折り返し)は残す', () => {
    const P = pts(0, 0, 1, 0, 2, 0, 1, 0, 0, 0);
    expect(dropReplays(P)).toBe(P);
  });

  it('筆圧が違えば別の点', () => {
    const P = Float32Array.from([0, 0, 0.3, 1, 0, 0.3, 0, 0, 0.5, 1, 0, 0.5]);
    expect(dropReplays(P)).toBe(P);
  });
});

describe('実機で書いた線(raw/tsugigami-20261028-1535.json)', () => {
  const data = JSON.parse(recorded) as { strokes: { pts: number[] }[] };

  it('描くための点列は、なぞり直しを除いてから平滑化したもの', () => {
    const P = Float32Array.from(data.strokes[0].pts), D = dropReplays(P);
    expect(Array.from(renderPts(P))).toEqual(Array.from(smoothPts(D, latticeStep(D) * SMOOTH_SIGMA)));
  });

  it('ほとんどの線になぞり直しがある', () => {
    const withReplay = data.strokes.filter(st => { const P = Float32Array.from(st.pts); return dropReplays(P).length < P.length; });
    expect(withReplay.length / data.strokes.length).toBeGreaterThan(0.9);
  });

  it('ほとんどの線で格子(約 0.4 px)が見つかり、平滑化で点は格子 2 つ分も動かない', () => {
    let found = 0, moved = 0, total = 0;
    for (const st of data.strokes) {
      const P = dropReplays(Float32Array.from(st.pts)), g = latticeStep(P);
      if (P.length < 4 * 3) continue;
      total++;
      if (!g) continue;
      found++;
      expect(g).toBeGreaterThan(0.39);
      expect(g).toBeLessThan(0.43);
      const S = smoothPts(P, g * SMOOTH_SIGMA);
      for (let j = 0; j < P.length; j += 3) moved = Math.max(moved, Math.hypot(S[j] - P[j], S[j + 1] - P[j + 1]) / g);
    }
    expect(found / total).toBeGreaterThan(0.9);
    expect(moved).toBeLessThan(2);
  });
});
