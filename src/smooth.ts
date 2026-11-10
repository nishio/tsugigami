// 線を描く前の平滑化。保存してある点列は変えず、描くときにだけ使う(DOM に依存しない純粋関数)。
//
// iPad の Safari が渡すペンの座標は、デバイス画素(CSS px の 0.5)の格子に揃っている。
// ノート座標に直すと、格子の間隔 q は「書いたときの 1 デバイス画素」= 1 / (倍率 × dpr)。
// 等倍のまま拡大すると、この格子が階段として見える(水平に近い線で目立つ)。
// そこで q を点列から推定し、q に比例した幅で滑らかにする。表示の倍率には依らない:
// 失われた精度は書いたときの倍率で決まっていて、拡大して見ても情報は増えないから。
// 詳しくは wiki/decisions/2026-11-10_平滑化は書いたときの画素の幅で.md

/** 格子の間隔の候補として扱う最小値(Float32 で保存した座標の丸めより十分大きく) */
const MIN_STEP = 0.02;

/**
 * 点列の座標が揃っている格子の間隔(ノート座標)。揃っていなければ 0。
 * 隣り合う点の差 |dx|, |dy| のうち 0 でないものが、ほぼすべて(9 割)ある間隔の整数倍になっているかで見る。
 */
export function latticeStep(P: ArrayLike<number>, stride = 3): number {
  const d: number[] = [];
  for (let j = stride; j < P.length; j += stride) {
    for (const v of [Math.abs(P[j] - P[j - stride]), Math.abs(P[j + 1] - P[j + 1 - stride])]) if (v > MIN_STEP / 2) d.push(v);
  }
  if (d.length < 4) return 0;
  const min = Math.min(...d);
  // 最小の差が格子の 2 倍や 3 倍のこともある(速く書いた線)ので、割った値も試す
  for (let k = 1; k <= 4; k++) {
    const c = min / k;
    if (c < MIN_STEP) break;
    let ok = 0;
    for (const v of d) { const r = v / c; if (Math.abs(r - Math.round(r)) < 0.15) ok++; }
    if (ok >= d.length * 0.9) return c;
  }
  return 0;
}

/** 平滑化の幅(格子の間隔の何倍か)。合成した線で、直線・円・角のずれと折れの少なさを比べて決めた */
export const SMOOTH_SIGMA = 4;

/**
 * 弧長に沿った局所 2 次回帰(重みはガウス、幅 sigma)。2 次式を当てるので、ガウスで平均するのと違って
 * 小さな円が縮まず、線の端も内側へ引っ込まない。筆圧(3 つ目)はそのまま。
 */
export function smoothPts(P: ArrayLike<number>, sigma: number, stride = 3): Float32Array {
  const n = Math.floor(P.length / stride), Q = Float32Array.from(P as ArrayLike<number>);
  if (n < 3 || !(sigma > 0)) return Q;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(P[i * stride] - P[(i - 1) * stride], P[i * stride + 1] - P[(i - 1) * stride + 1]);
  const R = 3 * sigma, k2 = -0.5 / (sigma * sigma);
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    while (s[i] - s[lo] > R) lo++;
    while (hi + 1 < n && s[hi + 1] - s[i] <= R) hi++;
    const xi = P[i * stride], yi = P[i * stride + 1];
    let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, X0 = 0, X1 = 0, X2 = 0, Y0 = 0, Y1 = 0, Y2 = 0;
    for (let j = lo; j <= hi; j++) {
      const t = s[j] - s[i], w = Math.exp(t * t * k2), wt = w * t, wt2 = wt * t;
      const x = P[j * stride] - xi, y = P[j * stride + 1] - yi;
      S0 += w; S1 += wt; S2 += wt2; S3 += wt2 * t; S4 += wt2 * t * t;
      X0 += w * x; X1 += wt * x; X2 += wt2 * x;
      Y0 += w * y; Y1 += wt * y; Y2 += wt2 * y;
    }
    // [S0 S1 S2; S1 S2 S3; S2 S3 S4] c = [X0 X1 X2] の c0(クラメルの公式)
    const det = S0 * (S2 * S4 - S3 * S3) - S1 * (S1 * S4 - S2 * S3) + S2 * (S1 * S3 - S2 * S2);
    const c0 = (v0: number, v1: number, v2: number) => (v0 * (S2 * S4 - S3 * S3) - S1 * (v1 * S4 - S3 * v2) + S2 * (v1 * S3 - S2 * v2)) / det;
    // 点が少なすぎて 2 次式が決まらない(短い線の端など)ときは元の点のまま
    if (!(Math.abs(det) > 1e-9 * S0 * S0 * S0 * sigma ** 6)) continue;
    Q[i * stride] = xi + c0(X0, X1, X2);
    Q[i * stride + 1] = yi + c0(Y0, Y1, Y2);
  }
  return Q;
}

/** なぞり直しとみなす長さの上限(点の数)。1 回の pointermove の合体イベントは多くても 10 点ほど */
const MAX_REPLAY = 64;

/**
 * 直前の k 点(k ≥ 2)をそっくり繰り返している所を除く。iPad の Safari が同じ pointermove を 2 回届けていた頃
 * (2026-11-10 に入力側で直すまで)に書いた線は、点の 4 割ほどがこのなぞり直し。保存してある点列は変えない。
 */
export function dropReplays(P: Float32Array, stride = 3): Float32Array {
  const n = Math.floor(P.length / stride), out = new Float32Array(P.length);
  let m = 0; // out にある点の数
  const same = (a: number, b: number) => {
    for (let c = 0; c < stride; c++) if (out[a * stride + c] !== out[b * stride + c]) return false;
    return true;
  };
  for (let i = 0; i < n; i++) {
    out.set(P.subarray(i * stride, i * stride + stride), m * stride); m++;
    for (let k = 2; k <= MAX_REPLAY && 2 * k <= m; k++) {
      if (!same(m - 1, m - 1 - k)) continue;
      let all = true;
      for (let t = 2; t <= k && all; t++) all = same(m - t, m - t - k);
      if (all) { m -= k; break; }
    }
  }
  return m === n ? P : out.slice(0, m * stride);
}

/** 描くための点列。なぞり直しを除き、格子に揃っていれば平滑化する(ほかの端末や回転した線は揃っていない) */
export function renderPts(P: Float32Array): Float32Array {
  const D = dropReplays(P), q = latticeStep(D);
  return q ? smoothPts(D, q * SMOOTH_SIGMA) : D;
}
