// 当たり判定と 2 次元アフィン変換。DOM に依存しない純粋関数だけを置く(テスト対象)。
import { type Box, type Stroke, strokePad } from './model';

export function bboxOf(P: ArrayLike<number>, stride = 3, pad = 0): Box {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let j = 0; j < P.length; j += stride) {
    const x = P[j], y = P[j + 1];
    if (x < a) a = x; if (x > c) c = x;
    if (y < b) b = y; if (y > d) d = y;
  }
  return [a - pad, b - pad, c + pad, d + pad];
}

export const strokeBox = (s: Pick<Stroke, 'pts' | 'kind' | 'width'>): Box => bboxOf(s.pts, 3, strokePad(s.kind, s.width));

export const overlaps = (a: Box, b: Box): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

export const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

export const grow = (a: Box, r: number): Box => [a[0] - r, a[1] - r, a[2] + r, a[3] + r];

export function unionAll(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return boxes.reduce(union);
}

/** 点 (x, y) から線分 a-b までの距離の 2 乗 */
export function segDist2(ax: number, ay: number, bx: number, by: number, x: number, y: number): number {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? ((x - ax) * dx + (y - ay) * dy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - x, ey = ay + t * dy - y;
  return ex * ex + ey * ey;
}

/** 半径 r の消しゴムが (x, y) でストロークに触れているか */
export function strokeHit(s: Stroke, x: number, y: number, r: number): boolean {
  const b = s.b;
  if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) return false;
  const P = s.pts, m = r + strokePad(s.kind, s.width), m2 = m * m;
  if (P.length <= 3) return (P[0] - x) ** 2 + (P[1] - y) ** 2 <= m2;
  for (let j = 3; j < P.length; j += 3) {
    if (segDist2(P[j - 3], P[j - 2], P[j], P[j + 1], x, y) <= m2) return true;
  }
  return false;
}

/** poly は [x0, y0, x1, y1, ...] */
export function pointInPoly(x: number, y: number, poly: ArrayLike<number>): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1], xj = poly[j * 2], yj = poly[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 2 線分が交差するか、距離が r 以下か(端点・平行・長さ 0 も含む) */
function segmentsTouch(ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number, r2: number): boolean {
  const abC = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const abD = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const cdA = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const cdB = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return segDist2(ax, ay, bx, by, cx, cy) <= r2
    || segDist2(ax, ay, bx, by, dx, dy) <= r2
    || segDist2(cx, cy, dx, dy, ax, ay) <= r2
    || segDist2(cx, cy, dx, dy, bx, by) <= r2;
}

/** 投げ縄の内側または境界に、太さを含むストロークの一部でも触れれば選ぶ */
export function lassoHit(s: Stroke, poly: ArrayLike<number>, polyBox: Box): boolean {
  const P = s.pts;
  if (P.length < 3 || poly.length < 6 || !overlaps(s.b, polyBox)) return false;
  if (pointInPoly(P[0], P[1], poly)) return true;
  const r = strokePad(s.kind, s.width), r2 = r * r;
  // 点だけのストロークも長さ 0 の線分として調べる。点列を間引くと短い接触を落とす。
  for (let i = Math.min(3, P.length - 3); i < P.length; i += 3) {
    const a = Math.max(0, i - 3), ax = P[a], ay = P[a + 1], bx = P[i], by = P[i + 1];
    for (let j = 0, k = poly.length - 2; j < poly.length; k = j, j += 2) {
      const cx = poly[k], cy = poly[k + 1], dx = poly[j], dy = poly[j + 1];
      if (Math.max(ax, bx) + r < Math.min(cx, dx) || Math.min(ax, bx) - r > Math.max(cx, dx)
        || Math.max(ay, by) + r < Math.min(cy, dy) || Math.min(ay, by) - r > Math.max(cy, dy)) continue;
      if (segmentsTouch(ax, ay, bx, by, cx, cy, dx, dy, r2)) return true;
    }
  }
  return false;
}

/** アフィン変換 [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f */
export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** m ∘ n(n を先に適用) */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export const apply = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scaleAt = (f: number, cx: number, cy: number): Mat => [f, 0, 0, f, cx - f * cx, cy - f * cy];
export function rotateAt(t: number, cx: number, cy: number): Mat {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}
export const matScale = (m: Mat): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
export const isIdentity = (m: Mat): boolean => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);

/** 変換したストローク(id はそのまま)。太さは拡大率に合わせる */
export function transformStroke(s: Stroke, m: Mat): Stroke {
  const P = s.pts, Q = new Float32Array(P.length);
  for (let j = 0; j < P.length; j += 3) {
    const [x, y] = apply(m, P[j], P[j + 1]);
    Q[j] = x; Q[j + 1] = y; Q[j + 2] = P[j + 2];
  }
  const t = { ...s, pts: Q, width: s.width * matScale(m) };
  t.b = strokeBox(t);
  return t;
}
