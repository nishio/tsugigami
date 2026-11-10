---
title: iPad の Safari で届くイベントと機能(lab の記録から)
type: finding
confidence: 実機で確認
created: 2026-11-03
updated: 2026-11-10
sources:
  - raw/2026-10-30_lab_palm-rest/log.txt
  - raw/2026-10-30_lab_palm-rest/minutes-events.json
  - raw/2026-10-30_lab_taps/log.txt
---

# iPad の Safari で届くイベントと機能(lab の記録から)

[iPad の Web アプリでできないこと・怪しいこと](iPadとWebの制約.md) の表のうち、lab の記録(2026-10-30、iPad、Safari 27.0.1、画面 1024×1366、画素比 2、ビルド 2026-10-28 16:08)で確かめられた分を切り出したもの。新しく計測したのではなく、既に raw/ にある記録を読み直した。

## 分かったこと

| 項目 | 結果 | 根拠 |
|---|---|---|
| 合体イベント(`getCoalescedEvents`) | **届く。** 議事録の記録(イベントのあった 91 秒)の Pencil の pointermove 7,014 回すべてに付いていた。1 回あたり中央値 2 個、最大 9 個 | `minutes-events.json` の `co` |
| 予測イベント(`getPredictedEvents`) | **届く(毎回ではない)。** 同じ 7,014 回のうち 3,228 回(46%)に付いていた。1 回あたり中央値 2 個 | `minutes-events.json` の `pr` |
| 低遅延キャンバス(`desynchronized`) | `getContextAttributes()` が `desynchronized: true` を返す(計測欄の `lowLatency: true`)。**指定が受け付けられたことまで。** 実際に表示の遅れが縮んでいるかは測っていない | 両方の `log.txt` の env |
| ペンのホバー | **届いていない。** 議事録の記録の Pencil の pointermove に `buttons: 0`(浮かせた状態)は 0 回。計測欄の `hover` も `false`(lab-results/ に残る 2026-10-30 の 4 回の実行すべてで同じ。ページを開いている間に紙の上へ一度も届かなかった、という意味)。この iPad と Pencil の組み合わせがホバーに対応していないのか、Safari が渡さないのかは分からない | `minutes-events.json`、`log.txt` の env |
| move イベントの頻度 | 直近のストロークで 1 秒あたり 231〜234 回、点(合体イベントを含む)は 471〜478 点 | `log.txt` の env の `evRate`・`ptRate` |
| JS に届くまでの時間 | 直近のストロークの平均で 5.2ms と 36.3ms。1 本ずつの値で、ばらつきは大きい | `log.txt` の env の `lagMs` |

計測欄の値(`stats`)のうち、`evRate`・`ptRate`・`lagMs` は「直近のストローク」のもので、実験の始まりの時点では前の実験の値が残っている。`hover`・`coalesced`・`predicted` は「ページを開いてから一度でも届いたか」を表し、一度 `true` になると戻らない(リセットする処理は無い。[src/controller.ts](../../src/controller.ts) の `stats`)。だから `hover: false` は、そのページを開いている間に Pencil のホバーの pointermove が紙の上に一度も届かなかった、という意味になる。どちらの値も本物の Pencil で書いた線から来ている(lab の合成入力には合体・予測イベントが付かない。[iPad 自身を実験機にする](../decisions/2026-10-28_iPad自身を実験機にする.md))。

**(2026-11-10 追記)** 上の「7,014 回すべてに付いていた」の 7,014 回のうち 3,325 回は、直前の move の**複製**(同じ時刻、同じ合体イベントの列)だった。Safari は合体イベントが 2 個以上の move をほぼ毎回 2 回届ける([finding](Safariは同じpointermoveを2回届ける.md))。重複を除くと move は 3,689 回、1 秒あたりの回数(`evRate`)も約半分と読むべき。また合体イベントの座標はすべて 0.5 CSS px の倍数だった([finding](Pencilの座標はデバイス画素に丸められる.md))。

## 何に効くか

- ホバーが届かないので、「ペンを近づけた時点で手のひらを無視し始める」案([手のひら判定](../concepts/手のひら判定.md))はこの環境では使えない。
- 予測イベントはおよそ半分の move にしか付かないので、ペン先の遅れを縮める工夫([描画の層とタイル](../concepts/描画の層とタイル.md))は、付かない回でも破綻しないことが前提になる(コードは既にそう書いてある)。
- 低遅延キャンバスが有効なので、[線のガタつき](線のガタつきの計測.md) の「ライブ層が画面に残っている」見立て(`desynchronized` のキャンバスで消去が表示に反映されない可能性)は、引き続き候補のまま。

## まだ分からないこと

- 画面の更新頻度(rAF が 120Hz で回るか)。計測欄に無い。
- 低遅延キャンバスで実際に遅れが縮んでいるか。

## Sources

- [raw/2026-10-30_lab_palm-rest/log.txt](../../raw/2026-10-30_lab_palm-rest/log.txt)(env: `lowLatency`、`stats`)、[minutes-events.json](../../raw/2026-10-30_lab_palm-rest/minutes-events.json)(Pencil の pointermove の `co`・`pr`・`buttons`)
- [raw/2026-10-30_lab_taps/log.txt](../../raw/2026-10-30_lab_taps/log.txt)(env)
- 記録の形: [src/lab/api.ts](../../src/lab/api.ts) の `record()`、計測欄: [src/controller.ts](../../src/controller.ts) の `stats`、[src/render.ts](../../src/render.ts) の `lowLatency`
