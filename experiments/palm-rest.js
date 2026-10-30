// 書いている最中の手のひらと、わざとのスクロール・ピンチが、タッチのイベント列としてどう違うかを記録する。
// 議事録で「手のひらの後判定で紙が拡大縮小してずれる」が頻発した(raw/2026-10-30_議事録で使った感想_パーム後判定の拡縮ずれ.md)。
// nishio「想像で条件式を書くのではなくデータを集めるべき」(raw/2026-10-30_想像ではなくデータを集めるべき.md)。
// 記録するもの: 全ポインタイベント(種類・id・座標・筆圧・接地面の大きさ w/h・合体イベント)。ペンも指も同じ時間軸に入る。
// 見方は tools/palm-features.mjs(タッチ 1 本ごとに、ペンとの前後関係・静止時間・移動量・同時に触れていた点との間隔を出す)。
lab.log('env', lab.env());
await lab.note();
await lab.view(0, 0, 1);

// 間違えて「次へ」を押しても、記録が足りなければもう一度頼む(enough が true になるまで)
const phase = async (name, text, enough) => {
  const v0 = { ...lab.app.r.view }, palm0 = lab.app.c.stats.palm;
  const rec = lab.record();
  let prompt = text;
  for (;;) {
    await lab.ask(prompt);
    if (enough(rec.events)) break;
    prompt = '【まだ記録が足りません。「次へ」は終わってから押してください】 ' + text;
  }
  await lab.sleep(100);
  rec.stop();
  const v1 = { ...lab.app.r.view };
  const touches = rec.events.filter(e => e.pt === 'touch');
  const ids = new Set(touches.map(e => e.id));
  lab.log(name, { events: rec.events.length, touches: touches.length, touchIds: ids.size, palm: lab.app.c.stats.palm - palm0, view0: v0, view1: v1 });
  lab.save(`${name}-events.json`, rec.events);
  lab.save(`${name}-summary.json`, { view0: v0, view1: v1, palm: lab.app.c.stats.palm - palm0, touchIds: [...ids] });
};

await phase('minutes',
  '議事録を取るときと同じように、このノートに 2〜3 分ほど自然に書いてください。途中で手を置いたまま考える時間、手を置き直す動き、必要ならスクロールも、普段どおりに。紙が勝手にずれたら、そのまま続けてください(それが記録したい現象です)。終わったら「次へ」。',
  ev => ev.filter(e => e.pt === 'pen' && e.type === 'pointerdown').length >= 20);
await phase('rest-only',
  'Pencil を使わずに、手だけを画面に 3 秒ほど置いて、そのまま少しずらしたり転がしたりしてから離してください。終わったら「次へ」。',
  ev => ev.filter(e => e.pt === 'touch' && e.type === 'pointermove').length >= 10);
await phase('pinch',
  'わざとのピンチ: 2 本の指で紙を拡大してから、縮小して戻してください。終わったら「次へ」。',
  ev => new Set(ev.filter(e => e.pt === 'touch').map(e => e.id)).size >= 2 && ev.filter(e => e.pt === 'touch' && e.type === 'pointermove').length >= 20);
await phase('scroll',
  'わざとのスクロール: 1 本の指で紙を上下に動かしてください。終わったら「次へ」。',
  ev => ev.filter(e => e.pt === 'touch' && e.type === 'pointermove').length >= 20);
lab.save('strokes.json', lab.strokes());
lab.say('終わりです。ありがとうございます。');
