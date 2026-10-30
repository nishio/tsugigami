// 置いた手(手のひら)がどんなタッチとして届くかを記録する。
// 議事録で「手のひらの後判定で紙が拡大縮小してずれる」が頻発した(raw/2026-10-30_議事録で使った感想_パーム後判定の拡縮ずれ.md)。
// 知りたいこと: 手のひらは何点のタッチになるか、点の間隔と時間差、接地面の大きさ(width/height)が指と違うか、
// 静止してから動き出すまでの時間、ペン先からの相対位置。わざとのピンチ・スクロールも同じ形で記録して比べる。
lab.log('env', lab.env());
await lab.note();
await lab.view(0, 0, 1);

const phase = async (name, text) => {
  const v0 = { ...lab.app.r.view }, palm0 = lab.app.c.stats.palm;
  const rec = lab.record();
  await lab.ask(text);
  await lab.sleep(100);
  rec.stop();
  const v1 = { ...lab.app.r.view };
  const touches = rec.events.filter(e => e.pt === 'touch');
  const ids = new Set(touches.map(e => e.id));
  lab.log(name, { events: rec.events.length, touches: touches.length, touchIds: ids.size, palm: lab.app.c.stats.palm - palm0, view0: v0, view1: v1 });
  lab.save(`${name}-events.json`, rec.events);
  lab.save(`${name}-summary.json`, { view0: v0, view1: v1, palm: lab.app.c.stats.palm - palm0, touchIds: [...ids] });
};

await phase('write-rested',
  '議事録を取るときと同じ姿勢で、手を画面に置いたまま Pencil で 2〜3 行書いてください。書き終わったら手を置いたまま 5 秒ほど待ち、手を少しずらしてから、もう 1 行書いてください。終わったら「次へ」。');
await phase('rest-only',
  'Pencil を使わずに、手だけを画面に 3 秒ほど置いて、そのまま少しずらしたり転がしたりしてから離してください。終わったら「次へ」。');
await phase('pinch',
  'わざとのピンチ: 2 本の指で紙を拡大してから、縮小して戻してください。終わったら「次へ」。');
await phase('scroll',
  'わざとのスクロール: 1 本の指で紙を上下に動かしてください。終わったら「次へ」。');
lab.save('strokes.json', lab.strokes());
lab.say('終わりです。ありがとうございます。');
