// タップした時点までの軌跡から形を選ぶ。保存時は既存の点列へ変換する。
export type Shape = { kind: 'line'; x: number; y: number }
  | { kind: 'circle'; cx: number; cy: number; radius: number };

export function inferShape(P: ArrayLike<number>): Shape | null {
  const n = P.length / 3;
  if (n < 3) return null;
  let mx = 0, my = 0, length = 0;
  for (let i = 0; i < n; i++) {
    mx += P[i * 3]; my += P[i * 3 + 1];
    if (i) length += Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2]);
  }
  if (length < 12) return null;
  mx /= n; my /= n;
  let xx = 0, xy = 0, yy = 0, xr = 0, yr = 0, span = 0;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] - mx, y = P[i * 3 + 1] - my, r2 = x * x + y * y;
    xx += x * x; xy += x * y; yy += y * y; xr += x * r2; yr += y * r2;
    span = Math.max(span, Math.sqrt(r2));
  }
  const lineError = Math.sqrt(Math.max(0, (xx + yy - Math.hypot(xx - yy, 2 * xy)) / (2 * n)));
  if (lineError <= Math.max(0.6, span * 0.025)) return { kind: 'line', x: P[0], y: P[1] };
  const det = xx * yy - xy * xy;
  if (n < 8 || det <= 1e-9 * (xx + yy) ** 2) return null;
  const cx = mx + (xr * yy - yr * xy) / (2 * det), cy = my + (yr * xx - xr * xy) / (2 * det);
  let radius = 0;
  for (let i = 0; i < n; i++) radius += Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy);
  radius /= n;
  let error = 0, turn = 0, last = Math.atan2(P[1] - cy, P[0] - cx);
  for (let i = 0; i < n; i++) {
    error += (Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy) - radius) ** 2;
    const angle = Math.atan2(P[i * 3 + 1] - cy, P[i * 3] - cx);
    let d = angle - last; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; turn += d; last = angle;
  }
  const circleError = Math.sqrt(error / n);
  if (radius >= 3 && Math.abs(turn) >= Math.PI / 2 && Math.abs(turn) < Math.PI * 3
    && circleError <= radius * 0.06 && circleError * 2 < lineError) return { kind: 'circle', cx, cy, radius };
  return null;
}

export function shapePoints(shape: Shape, raw: ArrayLike<number>): Float32Array {
  const j = raw.length - 3, x = raw[j], y = raw[j + 1], p = raw[j + 2];
  if (shape.kind === 'line') {
    const dx = Math.abs(x - shape.x), dy = Math.abs(y - shape.y), nearAxis = Math.tan(8 * Math.PI / 180);
    const endX = dx <= dy * nearAxis ? shape.x : x, endY = dy <= dx * nearAxis ? shape.y : y;
    return Float32Array.from([shape.x, shape.y, raw[2], endX, endY, p]);
  }
  const radius = Math.hypot(x - shape.cx, y - shape.cy);
  const n = Math.min(512, Math.max(32, Math.ceil(Math.PI * Math.sqrt(Math.max(1, radius) / 0.05))));
  const P = new Float32Array((n + 1) * 3), start = Math.atan2(raw[1] - shape.cy, raw[0] - shape.cx);
  for (let i = 0; i < n; i++) {
    const a = start + (2 * Math.PI * i) / n;
    P[i * 3] = shape.cx + radius * Math.cos(a); P[i * 3 + 1] = shape.cy + radius * Math.sin(a); P[i * 3 + 2] = p;
  }
  P.set(P.subarray(0, 3), n * 3); // 閉じ目を完全に一致させる
  return P;
}

export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, ink: { pts: ArrayLike<number>; width: number; color: string }): void {
  const P = shapePoints(shape, ink.pts);
  ctx.strokeStyle = ink.color; ctx.lineWidth = ink.width; ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(P[0], P[1]);
  for (let j = 3; j < P.length; j += 3) ctx.lineTo(P[j], P[j + 1]);
  ctx.stroke();
}
