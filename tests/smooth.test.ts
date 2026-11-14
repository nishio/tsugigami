import { describe, expect, it } from 'vitest';
import slowLine from '../raw/2026-10-30_lab_aa-live-vs-tile/pencil-strokes.json?raw';
import recorded from '../raw/tsugigami-20261028-1535.json?raw';
import { INK_MARGIN, SMOOTH_SIGMA, clampToBox, dropReplays, latticeStep, renderPts, smoothAdaptive, smoothPts } from '../src/smooth';

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

/** 弧長 h ごとに取り直した折れ線の、向きの変化の絶対値の中央値(度)。手の大きな動きに左右されにくい、細かい段の目安 */
function medianTurn(P: ArrayLike<number>, h: number): number {
  const s = [0];
  for (let j = 3; j < P.length; j += 3) s.push(s[s.length - 1] + Math.hypot(P[j] - P[j - 3], P[j + 1] - P[j - 2]));
  const R: [number, number][] = [];
  for (let t = 0, i = 0; t <= s[s.length - 1]; t += h) {
    while (i + 1 < s.length - 1 && s[i + 1] < t) i++;
    const u = (t - s[i]) / (s[i + 1] - s[i] || 1);
    R.push([P[i * 3] + u * (P[i * 3 + 3] - P[i * 3]), P[i * 3 + 1] + u * (P[i * 3 + 4] - P[i * 3 + 1])]);
  }
  const d: number[] = [];
  for (let i = 2; i < R.length; i++) {
    let x = Math.atan2(R[i][1] - R[i - 1][1], R[i][0] - R[i - 1][0]) - Math.atan2(R[i - 1][1] - R[i - 2][1], R[i - 1][0] - R[i - 2][0]);
    x -= Math.round(x / (2 * Math.PI)) * 2 * Math.PI;
    d.push(Math.abs(x));
  }
  d.sort((a, b) => a - b);
  return (d[d.length >> 1] * 180) / Math.PI;
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

  it('GitHub から戻した線(座標を 0.01 に丸めた)で、速く書いた線(点の間が格子の 10 倍ほど)でも見つける', () => {
    // 2026-11-13 の実機のページで、水平な長い線の格子(0.284)が見つからず、ならされていなかった
    const q2 = 0.2841, r = rng(7), P: number[] = [];
    let x = 32.96;
    for (let i = 0; i < 100; i++) {
      x += q2 * (1 + Math.floor(r() * 10));
      const y = 12734 + 3 * Math.sin(x / 40);
      P.push(Math.round(Math.round(x / q2) * q2 * 100) / 100, Math.round(Math.round(y / q2) * q2 * 100) / 100, 0.2);
    }
    expect(Math.abs(latticeStep(P) - q2)).toBeLessThan(0.01 * q2);
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

describe('smoothAdaptive', () => {
  const line = (slope: number) => (s: number): [number, number] => [s / Math.hypot(1, slope), (s * slope) / Math.hypot(1, slope)];

  it('水平に近い長い線のゆるい段を、幅 4q よりずっとならす(nishio「水平に近い長めの線」2026-11-10)', () => {
    // 4 通りの格子のずれで平均する。2026-11-10 の値(真の線からの RMS、幅 4q → 幅を選ぶ): 傾き 0.01 で 0.27q → 0.12q、0.03 で 0.24q → 0.06q
    for (const [slope, L, ratio] of [[0.01, 200, 0.6], [0.03, 120, 0.4]]) {
      const f = line(slope);
      let a = 0, b = 0, ja = 0, jb = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const { P } = quantized(f, L, q, seed), A = smoothAdaptive(P, q), S = smoothPts(P, q * SMOOTH_SIGMA);
        a += deviation(A, f, L).rms; b += deviation(S, f, L).rms; ja += jaggedness(A, q); jb += jaggedness(S, q);
      }
      expect(a).toBeLessThan(ratio * b);
      expect(ja).toBeLessThan(jb);
    }
  });

  it('角は幅 4q と同じくらいしか丸めない、線の端も引っ込めない', () => {
    const f = (s: number): [number, number] => (s < 40 ? [s, 0.02 * s] : [40, 0.8 + (s - 40)]);
    const { P } = quantized(f, 80, q, 6);
    const A = smoothAdaptive(P, q), n = A.length;
    expect(deviation(A, f, 80).max).toBeLessThan(Math.max(1.1 * deviation(smoothPts(P, q * SMOOTH_SIGMA), f, 80).max, q));
    expect(Math.hypot(A[0] - P[0], A[1] - P[1])).toBeLessThan(q);
    expect(Math.hypot(A[n - 3] - P[n - 3], A[n - 2] - P[n - 2])).toBeLessThan(q);
  });

  it('小さな円はほとんど縮めない(格子の 0.2 倍まで)', () => {
    for (const R of [3, 5, 12]) {
      const f = (s: number): [number, number] => [R * Math.cos(s / R), R * Math.sin(s / R)];
      const { P } = quantized(f, 2 * Math.PI * R, q, 4);
      const A = smoothAdaptive(P, q);
      let sum = 0;
      for (let j = 0; j < A.length; j += 3) sum += Math.hypot(A[j], A[j + 1]);
      expect(Math.abs(sum / (A.length / 3) - R)).toBeLessThan(0.2 * q);
      expect(jaggedness(A, q)).toBeLessThan(jaggedness(P, q) / 2);
    }
  });

  it('手の揺れ(格子より大きいうねり)は消さない', () => {
    const f = (s: number): [number, number] => [s, Math.sin((2 * Math.PI * s) / 30)];
    const { P } = quantized(f, 120, q, 8);
    expect(deviation(smoothAdaptive(P, q), f, 120).max).toBeLessThan(0.6 * q);
  });

  it('筆圧はそのまま、点の数も変えない。2 点以下と格子 0 はそのまま', () => {
    const { P } = quantized(s => [s, 0.02 * s], 60, q);
    P[5] = 0.9;
    const A = smoothAdaptive(P, q);
    expect(A.length).toBe(P.length);
    expect(A[5]).toBeCloseTo(0.9);
    expect(Array.from(smoothAdaptive([1, 2, 0.3, 3, 4, 0.3], q))).toEqual([1, 2, expect.closeTo(0.3), 3, 4, expect.closeTo(0.3)]);
    expect(Array.from(smoothAdaptive(P, 0))).toEqual(Array.from(P));
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

  it('描くための点列は、なぞり直しを除いてから平滑化し、元の点の外接矩形 + INK_MARGIN に収めたもの', () => {
    const P = Float32Array.from(data.strokes[0].pts), D = dropReplays(P);
    expect(Array.from(renderPts(P))).toEqual(Array.from(clampToBox(smoothAdaptive(D, latticeStep(D)), D, INK_MARGIN)));
  });

  it('ほとんどの線になぞり直しがある', () => {
    const withReplay = data.strokes.filter(st => { const P = Float32Array.from(st.pts); return dropReplays(P).length < P.length; });
    expect(withReplay.length / data.strokes.length).toBeGreaterThan(0.9);
  });

  it('描く点が元の点の外接矩形から出る幅は INK_MARGIN の中(タイルはその幅だけ広く線を選ぶ。超えると丸い端がタイルの境目で切れる。issue #4)', () => {
    let over = 0;
    for (const st of data.strokes) {
      const P = Float32Array.from(st.pts), S = renderPts(P);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let j = 0; j < P.length; j += 3) { x0 = Math.min(x0, P[j]); x1 = Math.max(x1, P[j]); y0 = Math.min(y0, P[j + 1]); y1 = Math.max(y1, P[j + 1]); }
      for (let j = 0; j < S.length; j += 3) over = Math.max(over, x0 - S[j], S[j] - x1, y0 - S[j + 1], S[j + 1] - y1);
    }
    expect(over).toBeGreaterThan(0); // 平滑化した端は実際に外へ出る(だからタイルを広げる)
    expect(over).toBeLessThan(INK_MARGIN / 2); // 寄せる処理に頼らず、ふだんは余裕をもって収まる
  });

  it('寄せる処理は、外接矩形 + 幅の外の点だけを動かす', () => {
    const R = Float32Array.from([0, 0, 1, 10, 10, 1]);
    expect(Array.from(clampToBox(Float32Array.from([-0.5, 5, 1, 12, 3, 1]), R, 1))).toEqual([-0.5, 5, 1, 11, 3, 1]);
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
      const S = renderPts(P);
      for (let j = 0; j < P.length; j += 3) moved = Math.max(moved, Math.hypot(S[j] - P[j], S[j + 1] - P[j + 1]) / g);
    }
    expect(found / total).toBeGreaterThan(0.9);
    expect(moved).toBeLessThan(2);
  });
});

describe('実機でゆっくり引いた横線(raw/2026-10-30_lab_aa-live-vs-tile)', () => {
  const line = (JSON.parse(slowLine) as { z: number; pts: number[] }[]).find(st => st.z === 2)!;
  const P = dropReplays(Float32Array.from(line.pts)), g = latticeStep(P);

  it('格子が見つかる', () => {
    expect(g).toBeGreaterThan(0.41);
    expect(g).toBeLessThan(0.43);
  });

  it('細かい折れ(弧長 2 格子ごとの向きの変化の中央値)が、幅 4q の平滑化より大きく減る', () => {
    // 2026-11-10 の値: 幅 4q 0.93°、幅を選ぶ平滑化 0.47°
    expect(medianTurn(smoothAdaptive(P, g), 2 * g)).toBeLessThan(0.7 * medianTurn(smoothPts(P, g * SMOOTH_SIGMA), 2 * g));
  });

  it('点は格子 2 つ分も動かない(ペンを離した瞬間に線が飛ばない)', () => {
    const A = smoothAdaptive(P, g);
    let moved = 0;
    for (let j = 0; j < P.length; j += 3) moved = Math.max(moved, Math.hypot(A[j] - P[j], A[j + 1] - P[j + 1]) / g);
    expect(moved).toBeLessThan(2);
  });
});
