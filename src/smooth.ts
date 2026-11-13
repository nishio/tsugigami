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

/** 弧長(点 0 からの折れ線の長さ) */
function arcLength(P: ArrayLike<number>, stride: number, n: number): Float64Array {
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(P[i * stride] - P[(i - 1) * stride], P[i * stride + 1] - P[(i - 1) * stride + 1]);
  return s;
}

/**
 * 弧長 at を中心に、点 lo..hi へ 2 次式を当てた値を out[o], out[o + 1] に書く(ガウスの重み、幅 sigma)。
 * 点が少なすぎて 2 次式が決まらない(短い線の端など)ときは false。
 */
function fitAt(P: ArrayLike<number>, stride: number, s: Float64Array, at: number, lo: number, hi: number, sigma: number, out: Float64Array, o: number): boolean {
  const k2 = -0.5 / (sigma * sigma), rx = P[lo * stride], ry = P[lo * stride + 1];
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, X0 = 0, X1 = 0, X2 = 0, Y0 = 0, Y1 = 0, Y2 = 0;
  for (let j = lo; j <= hi; j++) {
    const t = s[j] - at, w = Math.exp(t * t * k2), wt = w * t, wt2 = wt * t;
    const x = P[j * stride] - rx, y = P[j * stride + 1] - ry;
    S0 += w; S1 += wt; S2 += wt2; S3 += wt2 * t; S4 += wt2 * t * t;
    X0 += w * x; X1 += wt * x; X2 += wt2 * x;
    Y0 += w * y; Y1 += wt * y; Y2 += wt2 * y;
  }
  // [S0 S1 S2; S1 S2 S3; S2 S3 S4] c = [X0 X1 X2] の c0(クラメルの公式)
  const det = S0 * (S2 * S4 - S3 * S3) - S1 * (S1 * S4 - S2 * S3) + S2 * (S1 * S3 - S2 * S2);
  if (!(Math.abs(det) > 1e-9 * S0 * S0 * S0 * sigma ** 6)) return false;
  const c0 = (v0: number, v1: number, v2: number) => (v0 * (S2 * S4 - S3 * S3) - S1 * (v1 * S4 - S3 * v2) + S2 * (v1 * S3 - S2 * v2)) / det;
  out[o] = rx + c0(X0, X1, X2);
  out[o + 1] = ry + c0(Y0, Y1, Y2);
  return true;
}

/**
 * 弧長 at[0..m-1](増えていく)の各所で 2 次式を当てた値。決まらない所は NaN。
 * 窓は ±3 sigma(その外の重みは 1% 強で、打ち切っても線は変わらない)。
 */
function fitsAlong(P: ArrayLike<number>, stride: number, s: Float64Array, n: number, at: ArrayLike<number>, sigma: number): Float64Array {
  const m = at.length, F = new Float64Array(2 * m).fill(NaN), R = 3 * sigma;
  let lo = 0, hi = 0;
  for (let g = 0; g < m; g++) {
    while (lo < n - 1 && at[g] - s[lo] > R) lo++;
    while (hi + 1 < n && s[hi + 1] - at[g] <= R) hi++;
    fitAt(P, stride, s, at[g], lo, Math.max(lo, hi), sigma, F, 2 * g);
  }
  return F;
}

/**
 * 弧長に沿った局所 2 次回帰(重みはガウス、幅 sigma)。2 次式を当てるので、ガウスで平均するのと違って
 * 小さな円が縮まず、線の端も内側へ引っ込まない。筆圧(3 つ目)はそのまま。
 */
export function smoothPts(P: ArrayLike<number>, sigma: number, stride = 3): Float32Array {
  const n = Math.floor(P.length / stride), Q = Float32Array.from(P as ArrayLike<number>);
  if (n < 3 || !(sigma > 0)) return Q;
  const s = arcLength(P, stride, n), F = fitsAlong(P, stride, s, n, s, sigma);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(F[2 * i])) continue; // 決まらなければ元の点のまま
    Q[i * stride] = F[2 * i];
    Q[i * stride + 1] = F[2 * i + 1];
  }
  return Q;
}

/**
 * 幅を広げる段の数。段 k の幅は SMOOTH_SIGMA × 2^k 格子(4, 8, 16, 32, 64 格子)。
 * 傾き m の線の段の間隔は q / m(傾き 0.03 で 33 格子)なので、それより広い幅が要る(nishio「水平に近い長めの線」2026-11-10)。
 */
export const SMOOTH_LEVELS = 4;
/** 広い幅の線が、狭い幅の線からこれ(格子の何倍)より離れたら、そこではその幅を使わない */
export const SMOOTH_TAU = 0.5;
/** 段の切り替えをならす箱の半幅(格子の何倍)。2 回かけるので、ならしの届く範囲はこの 2 倍 */
const BLEND = 12;

/**
 * 幅を所ごとに選ぶ平滑化。まっすぐな所ほど広い幅でならす(水平に近い長い線の、ゆるい段を消す)。
 *
 * 各所で、幅 4q の線から始めて、幅を倍にした線が「それより狭いどの幅の線」からも SMOOTH_TAU 格子以内に
 * 収まる間は広げる(Lepski の方法の形)。角や曲がった所では広い幅の線が離れるので、狭い幅のまま残る。
 * 選んだ段は、点ごとに飛ぶと線に折れができるので、弧長に沿ってならし、隣の段の線の間を補間する。
 * ならす前に、届く範囲(2 × BLEND)の最小で削るので、ならした段がその点で選ばれた段を超えることはない
 * (角が広い幅で丸まらない)。
 * 広い幅の線は、幅の 1/4 ごとに求めて間を線形に補間する(どの段も手間がほぼ同じになる)。
 * 段 k は、段 k - 1 まで通った点の近くでだけ求める。
 */
export function smoothAdaptive(P: ArrayLike<number>, q: number, stride = 3): Float32Array {
  const n = Math.floor(P.length / stride), Q = Float32Array.from(P as ArrayLike<number>);
  if (n < 3 || !(q > 0)) return Q;
  const s = arcLength(P, stride, n), L = s[n - 1], K = SMOOTH_LEVELS;
  const F: Float64Array[] = [fitsAlong(P, stride, s, n, s, SMOOTH_SIGMA * q)];
  // 各点で使える段(段 0 も決まらなければ -1)。段 k は、段 k - 1 まで通った点でだけ求める(曲がった所は手間をかけない)
  const tau = SMOOTH_TAU * q, lev = new Float64Array(n);
  for (let i = 0; i < n; i++) lev[i] = Number.isNaN(F[0][2 * i]) ? -1 : 0;
  for (let k = 1; k <= K; k++) {
    const sigma = SMOOTH_SIGMA * q * 2 ** k, h = sigma / 4, m = Math.max(2, Math.ceil(L / h) + 1), R = 3 * sigma;
    const at = new Float64Array(m);
    for (let g = 0; g < m; g++) at[g] = Math.min(g * h, L);
    const G = new Float64Array(2 * m).fill(NaN), done = new Uint8Array(m), Fk = new Float64Array(2 * n).fill(NaN);
    let lo = 0, hi = 0, any = false;
    const node = (g: number) => { // g は減らない順に呼ばれる
      if (done[g]) return;
      done[g] = 1;
      while (lo < n - 1 && at[g] - s[lo] > R) lo++;
      while (hi + 1 < n && s[hi + 1] - at[g] <= R) hi++;
      fitAt(P, stride, s, at[g], lo, Math.max(lo, hi), sigma, G, 2 * g);
    };
    for (let i = 0, g = 0; i < n; i++) {
      if (lev[i] !== k - 1) continue;
      while (g < m - 2 && at[g + 1] < s[i]) g++;
      node(g); node(g + 1);
      const u = at[g + 1] > at[g] ? (s[i] - at[g]) / (at[g + 1] - at[g]) : 0;
      const x = G[2 * g] + u * (G[2 * g + 2] - G[2 * g]), y = G[2 * g + 1] + u * (G[2 * g + 3] - G[2 * g + 1]);
      let ok = true;
      for (let j = 0; j < k && ok; j++) ok = Math.hypot(x - F[j][2 * i], y - F[j][2 * i + 1]) <= tau; // NaN なら false
      if (ok) { Fk[2 * i] = x; Fk[2 * i + 1] = y; lev[i] = k; any = true; }
    }
    F.push(Fk);
    if (!any) break;
  }
  // 削って(最小)から、箱で 2 回ならす
  // (段 0 も決まらない点(-1)は、その点だけ元のまま。削りに入れると、線の端の広い範囲がならされなくなる)
  const a = BLEND * q, low = slide(lev.map(v => Math.max(v, 0)), s, 2 * a, (x, y) => Math.min(x, y));
  const sm = boxMean(boxMean(low, s, a), s, a);
  for (let i = 0; i < n; i++) {
    if (lev[i] < 0) continue;
    const l = Math.min(sm[i], lev[i]); // 丸めの誤差よけ(上の削りで sm ≤ lev のはず)
    const k0 = Math.floor(l), k1 = Math.min(F.length - 1, k0 + 1), u = l - k0;
    for (let c = 0; c < 2; c++) {
      const v0 = F[k0][2 * i + c], v1 = F[k1][2 * i + c];
      Q[i * stride + c] = u > 0 ? v0 + u * (v1 - v0) : v0;
    }
  }
  return Q;
}

/** 弧長で ±r の範囲の値を op でたたむ(r の中の点は少ないので素直に回す) */
function slide(v: Float64Array, s: Float64Array, r: number, op: (a: number, b: number) => number): Float64Array {
  const n = v.length, out = new Float64Array(n);
  for (let i = 0, lo = 0, hi = 0; i < n; i++) {
    while (s[i] - s[lo] > r) lo++;
    while (hi + 1 < n && s[hi + 1] - s[i] <= r) hi++;
    let acc = v[lo];
    for (let j = lo + 1; j <= hi; j++) acc = op(acc, v[j]);
    out[i] = acc;
  }
  return out;
}

/** 弧長で ±r の範囲の点の平均(累積和で) */
function boxMean(v: Float64Array, s: Float64Array, r: number): Float64Array {
  const n = v.length, out = new Float64Array(n), C = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) C[i + 1] = C[i] + v[i];
  for (let i = 0, lo = 0, hi = 0; i < n; i++) {
    while (s[i] - s[lo] > r) lo++;
    while (hi + 1 < n && s[hi + 1] - s[i] <= r) hi++;
    out[i] = (C[hi + 1] - C[lo]) / (hi - lo + 1);
  }
  return out;
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

/**
 * 描く線が、保存した外接矩形(元の点 ± 太さの半分)から外へ出てよい幅(ノート座標)。
 * 2 次式を当てた線の端は、元の点の外へ格子 1 つ分ほど伸びる(実機のノート 3180 本で最大 0.46)。
 * タイルは、この幅だけ広げた範囲で描く線を選び、焼き直す(render.ts)。広げないと、外へ出た丸い端が
 * 隣のタイルに描かれず、タイルの境目で四角く切れる(issue #4「描き初めが欠ける」、2026-11-14)。
 */
export const INK_MARGIN = 1;

/**
 * 描くための点列。なぞり直しを除き、格子に揃っていれば平滑化する(ほかの端末や回転した線は揃っていない)。
 * 平滑化した点は、元の点の外接矩形を INK_MARGIN 広げた中に収める(ふだんは届かない。縮めて書いた線の保険)。
 * 元の点の矩形ちょうどに寄せると、端の近くの点だけが片方の座標で止まり、線に折れができる。
 */
export function renderPts(P: Float32Array): Float32Array {
  const D = dropReplays(P), q = latticeStep(D);
  return q ? clampToBox(smoothAdaptive(D, q), D, INK_MARGIN) : D;
}

/** Q の点を、R の点の外接矩形を m 広げた中に寄せる(Q を書き換えて返す) */
export function clampToBox(Q: Float32Array, R: Float32Array, m = 0, stride = 3): Float32Array {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < R.length; j += stride) {
    if (R[j] < x0) x0 = R[j]; if (R[j] > x1) x1 = R[j];
    if (R[j + 1] < y0) y0 = R[j + 1]; if (R[j + 1] > y1) y1 = R[j + 1];
  }
  x0 -= m; y0 -= m; x1 += m; y1 += m;
  for (let j = 0; j < Q.length; j += stride) {
    Q[j] = Math.min(x1, Math.max(x0, Q[j]));
    Q[j + 1] = Math.min(y1, Math.max(y0, Q[j + 1]));
  }
  return Q;
}
