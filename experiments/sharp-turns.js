// 鋭い折り返しのある所で、描いた線に欠けが出る(nishio 2026-11-10)。どこで欠けるのかを iPad で確かめる。
// Linux の Chromium / WebKit では、同じ点列を本体と同じ描き方(中点から中点への 2 次曲線)で描いても欠けない。
//
// A) 合成の線を、本体を通さずに素のキャンバスへ描く。本体の描き方(mid)と、折れ線(poly)を並べる。
//    折り返しの形: ちょうど 180°、170°、160°、格子の上での小刻みな往復、なぞり直し(Safari が同じ move を 2 回届けた形)。
//    倍率は fit(1.2 × dpr 2)と、その 4 倍。
// B) 本物の Pencil で折り返しのある線を書いてもらい、fit と 4 倍で撮る(タイルとライブ層の合成)。生のイベントと点列も残す。
lab.log('env', lab.env());

// ---- A ----
const mid = P => {
  const p = new Path2D();
  p.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) {
    const mx = (P[i - 1][0] + P[i][0]) / 2, my = (P[i - 1][1] + P[i][1]) / 2;
    if (i === 1) p.lineTo(mx, my); else p.quadraticCurveTo(P[i - 1][0], P[i - 1][1], mx, my);
  }
  p.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
  return p;
};
const poly = P => { const p = new Path2D(); p.moveTo(P[0][0], P[0][1]); for (const q of P.slice(1)) p.lineTo(q[0], q[1]); return p; };
const q = 0.42;
// 折り返し角 deg(180 で真後ろ)。0→a で右へ、そこから折り返す
const bend = deg => {
  const r = ((180 - deg) * Math.PI) / 180, dx = -Math.cos(r), dy = Math.sin(r);
  return [[0, 0], [2, 0], [4, 0], [4 + 2 * dx, 2 * dy], [4 + 4 * dx, 4 * dy], [4 + 8 * dx, 8 * dy]];
};
const cases = {
  '180': [[0, 0], [2, 0], [4, 0], [2, 0.01], [0, 0.02], [-2, 0.03]],
  '170': bend(170),
  '160': bend(160),
  '120': bend(120),
  jitter: [[0, 0], [0, -q], [q, -q], [0, 0], [0, -q], [q, -q], [q, 0], [0, 2 * q], [0, 6 * q], [0, 14 * q], [0, 24 * q]],
  // 実機の記録(raw/tsugigami-20261028-1535.json の z=102 の書き始め)。7 点目で 1 点目に戻ってなぞり直す
  replay: [[0, 0], [-1, -1], [-2, -3], [-3, -4], [-4, -5], [-5, -6], [-5, -7], [-1, -1], [-2, -3], [-3, -4], [-4, -5], [-5, -6], [-5, -7], [-4, -8], [-3, -8], [-4, -8], [-3, -8], [-1, -8], [1, -8], [-1, -8], [1, -8], [3, -8], [5, -8], [3, -8], [5, -8], [8, -8], [11, -8]].map(([x, y]) => [x * q, y * q]),
};
const scales = [2.4, 9.6], cell = 150, names = Object.keys(cases);
const cv = document.createElement('canvas');
cv.width = cell * names.length * 2; cv.height = cell * scales.length;
const g = cv.getContext('2d');
g.fillStyle = '#fdfcf8'; g.fillRect(0, 0, cv.width, cv.height);
g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#000';
scales.forEach((s, row) => names.forEach((n, i) => [['mid', mid], ['poly', poly]].forEach(([k, f], j) => {
  const P = cases[n], xs = P.map(p => p[0]), ys = P.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  g.save();
  g.beginPath(); g.rect((i * 2 + j) * cell, row * cell, cell, cell); g.clip();
  g.translate((i * 2 + j) * cell + cell / 2, row * cell + cell / 2);
  g.scale(s * (row ? 1 : 2), s * (row ? 1 : 2)); // 1 段目は見やすいよう 2 倍に描く(画素の細かさは 2 段目で見る)
  g.translate(-cx, -cy);
  g.lineWidth = 2.2;
  g.stroke(f(P));
  g.restore();
  g.fillStyle = '#c00'; g.font = '11px sans-serif'; g.fillText(`${n} ${k} ×${s}`, (i * 2 + j) * cell + 3, row * cell + 12);
})));
lab.save('A-synthetic.png', await new Promise(res => cv.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), 'image/png')));
lab.log('A done', { w: cv.width, h: cv.height });

// ---- B ----
await lab.note();
const rec = lab.record();
await lab.ask('Pencil で、鋭く折り返す線を書いてください。たとえば「V」「W」「く」「レ」、細かいジグザグ、書き始めに小さく折り返す線。欠けが出やすい書き方があればそれも。書き終わったら「次へ」。');
await lab.sleep(100);
rec.stop();
lab.save('B-events.json', rec.events);
const strokes = lab.strokes();
lab.save('B-strokes.json', strokes);
const r = lab.app.r, fitS = r.fitScale();
if (strokes.length) {
  const b = strokes.reduce((a, s) => [Math.min(a[0], s.b[0]), Math.min(a[1], s.b[1]), Math.max(a[2], s.b[2]), Math.max(a[3], s.b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  await lab.shot('B-fit-all', [b[0] - 10, b[1] - 10, b[2] + 10, b[3] + 10]);
  // 1 本ずつ 4 倍で(書き始めが真ん中に来るように)
  let i = 0;
  for (const s of strokes.slice(0, 12)) {
    const s4 = fitS * 4, [x0, y0] = s.pts;
    await lab.view(x0 - r.W / 2 / s4, y0 - r.H / 2 / s4, s4);
    await lab.sleep(200);
    await lab.shot(`B-x4-${String(++i).padStart(2, '0')}`, [x0 - 40, y0 - 40, x0 + 40, y0 + 40]);
  }
}
await lab.ask('最後に一つだけ: さっき書いているとき、欠けは「書いている最中」に見えましたか、「ペンを離した後」に見えましたか(どちらも、でも)。答えは nishio から AI へ会話で伝えてください。「次へ」で終わります。');
return { strokes: strokes.length, events: rec.events.length, fitS };
