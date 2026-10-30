// lab の記録(*-events.json)から、タッチ 1 本ごとの特徴を表にする。
//   node tools/palm-features.mjs lab-results/<id>/minutes-events.json [...]
// 列: id, 開始時刻(s), 長さ(ms), 直前のペン(down/up からの ms、負なら記録前), 最初の静止(ms: 出発点から 10px 離れるまで),
//     移動量(px: 出発点からの最大距離), 経路長(px), w/h(最初と最大), 同時に触れていた他のタッチの id と間隔(px、最初/最大/最小),
//     ペンが触れている間に始まったか, ペン先からの相対位置(開始時、px)
import { readFileSync } from 'node:fs';

const SLOP = 10;
for (const file of process.argv.slice(2)) {
  const ev = JSON.parse(readFileSync(file, 'utf8'));
  const t0 = ev.length ? ev[0].t : 0;
  // ペンの状態の時系列
  const pen = ev.filter(e => e.pt === 'pen');
  const penAt = t => { // 直前のペンの down/up と、その時点でペンが触れていたか、ペン先の位置
    let down = null, up = null, pos = null, isDown = false;
    for (const p of pen) {
      if (p.t > t) break;
      if (p.type === 'pointerdown') { down = p.t; isDown = true; }
      else if (p.type === 'pointerup' || p.type === 'pointercancel') { up = p.t; isDown = false; }
      if (p.type !== 'pointerup') pos = [p.x, p.y];
    }
    return { down, up, isDown, pos };
  };
  const byId = new Map();
  for (const e of ev) {
    if (e.pt !== 'touch') continue;
    if (!byId.has(e.id) || e.type === 'pointerdown') byId.set(e.id, []);
    byId.get(e.id).push(e);
  }
  const tracks = [...byId.entries()].map(([id, es]) => ({ id, es, s: es[0].t, e: es[es.length - 1].t }));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  console.log(`# ${file}: ${ev.length} events, ${pen.length} pen, ${tracks.length} touches, ${((ev.at(-1)?.t ?? t0) - t0) / 1000 | 0}s`);
  console.log('id\tstart_s\tdur_ms\tpen_down_ago\tpen_up_ago\tpen_is_down\trest_ms\tmax_disp\tpath\tw0xh0\twmax\tothers\tdx,dy_from_pen');
  for (const tr of tracks) {
    const o = tr.es[0];
    let rest = null, maxD = 0, path = 0, wmax = 0;
    for (let i = 0; i < tr.es.length; i++) {
      const e = tr.es[i], d = dist(o, e);
      maxD = Math.max(maxD, d); wmax = Math.max(wmax, e.w ?? 0, e.h ?? 0);
      if (i) path += dist(tr.es[i - 1], e);
      if (rest === null && d >= SLOP) rest = e.t - o.t;
    }
    const pa = penAt(o.t);
    const others = tracks.filter(x => x !== tr && x.s <= tr.e && x.e >= tr.s).map(x => {
      // 重なっている時間帯の間隔(両方の直近の位置で)
      const ds = [];
      for (const e of tr.es) {
        const y = [...x.es].reverse().find(q => q.t <= e.t);
        if (y) ds.push(dist(e, y));
      }
      return ds.length ? `${x.id}:${Math.min(...ds) | 0}-${Math.max(...ds) | 0}(first ${ds[0] | 0})` : `${x.id}:-`;
    });
    const rel = pa.pos ? `${(o.x - pa.pos[0]) | 0},${(o.y - pa.pos[1]) | 0}` : '-';
    const ago = v => (v === null ? '-' : ((o.t - v) | 0));
    console.log([tr.id, ((o.t - t0) / 1000).toFixed(2), (tr.e - tr.s) | 0, ago(pa.down), ago(pa.up), pa.isDown ? 'Y' : 'n',
      rest === null ? 'never' : rest | 0, maxD | 0, path | 0, `${o.w ?? '-'}x${o.h ?? '-'}`, wmax, others.join(' ') || '-', rel].join('\t'));
  }
  console.log();
}
