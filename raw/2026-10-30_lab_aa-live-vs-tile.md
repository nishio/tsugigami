# 2026-10-30 lab: Pencil でゆっくり引いた横線(縁の潰れの切り分け)

iPad(Safari 27.0.1、ビルド `tsugigami 2026-10-28 16:08 lab`、dpr 2、倍率 1.19)で `aa-live-vs-tile`(lab id `20261028-1609-aa-live-vs-tile`)を nishio が実行した結果の一部。ファイルは [2026-10-30_lab_aa-live-vs-tile/](2026-10-30_lab_aa-live-vs-tile/)。2026-11-10 に lab-results/ から写した(拡大したときの階段の検査に、水平に近い長い線の実物が要ったため)。

- `pencil-events.json`: 「ゆっくり横線を 1 本引いてください(3 秒くらいかけて)」と頼んで、本物の Pencil で引いた線のイベント(1,643 個)。
- `pencil-strokes.json`: 実験の後のノートの線。z=2 が上の横線(2,484 点、幅 532 × 高さ 9。なぞり直しを除くと 1,577 点)。z=1 は実験の前半で合成のペン入力でなぞった四角(元は raw/tsugigami-20261028-1535.json の z=132)。
- `log.txt`: 実行ログ。

この版は Safari の pointermove の二重配送をそのまま足していたので、z=2 にもなぞり直しが入っている。画面の撮影(PNG)と合成入力の分は写していない(lab-results/ にだけある)。
