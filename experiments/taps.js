// わざとのタップ(2 本指 = 取り消し、3 本指 = やり直し)と、手を置いてすぐ離す動きが、タッチとしてどう違うかを記録する。
// 置いた手の記録(raw/2026-10-30_lab_palm-rest)では、2 点・9〜33ms の短い触れが 2 本指タップに見えて取り消しが起きる。
// 本物のタップの長さ(触れてから離すまで)と点の間隔を測り、タップの最短時間をデータから決める。
lab.log('env', lab.env());
await lab.note();
await lab.view(0, 0, 1);

const phase = async (name, text, enough) => {
  const rec = lab.record();
  let prompt = text;
  for (;;) {
    await lab.ask(prompt);
    if (enough(rec.events)) break;
    prompt = '【まだ記録が足りません。終わってから「次へ」を押してください】 ' + text;
  }
  await lab.sleep(100);
  rec.stop();
  const ids = new Set(rec.events.filter(e => e.pt === 'touch').map(e => e.id));
  lab.log(name, { events: rec.events.length, touchIds: ids.size });
  lab.save(`${name}-events.json`, rec.events);
};
const downs = ev => ev.filter(e => e.pt === 'touch' && e.type === 'pointerdown').length;

await phase('tap2', 'Pencil は置いておいて、2 本の指で画面を軽くトン、と 5 回タップしてください(取り消しのつもりで。普段の速さで)。終わったら「次へ」。', ev => downs(ev) >= 10);
await phase('tap3', '3 本の指で 5 回タップしてください(やり直しのつもりで)。終わったら「次へ」。', ev => downs(ev) >= 15);
await phase('hand-touch', '書くときの姿勢で、手を画面に置いてすぐ離す、を 5 回してください(Pencil は手に持ったまま、先は画面に付けない)。終わったら「次へ」。', ev => downs(ev) >= 5);
await phase('hand-write', '手を画面に置いて、Pencil で短い線を 1 本書いて、手ごと離す、を 5 回してください。終わったら「次へ」。', ev => ev.filter(e => e.pt === 'pen' && e.type === 'pointerdown').length >= 5);
lab.say('終わりです。ありがとうございます。');
