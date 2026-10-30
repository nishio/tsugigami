# 2026-10-30 lab: 置いた手・ピンチ・スクロール・議事録のタッチの記録

iPad(Safari 27.0.1、画面 1024×1366、ビルド 2026-10-28 16:08)で `experiments/palm-rest.js`(lab id `20261030-1320-palm-rest`)を nishio が実行した結果。ファイルは [2026-10-30_lab_palm-rest/](2026-10-30_lab_palm-rest/)。接地面の大きさ(`w`/`h`)は、このビルドの記録には入っていない。

- `minutes-events.json`: 議事録のつもりで 2 分半書いた(ペン 260 本、7,534 イベント)。
- `rest-only-events.json`: Pencil を使わず手だけを 14 秒置いて、ずらしたり転がしたりした。
- `pinch-events.json`: わざとのピンチ(拡大 → 縮小)。
- `scroll-events.json`: わざとの 1 本指スクロール(途中で 2 本指の拡大も含む)。
- `*-summary.json`: 各段の前後の表示位置と倍率、手のひらとして無視した回数。
- `log.txt`: 実行ログ。

見方は `tools/palm-features.mjs <events.json>`。
