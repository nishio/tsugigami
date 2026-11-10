---
title: iPad の Safari は合体イベントつきの pointermove を 2 回届ける
type: finding
confidence: 実機で確認
created: 2026-11-10
updated: 2026-11-10
sources:
  - raw/2026-10-30_lab_palm-rest/minutes-events.json
  - raw/2026-10-30_lab_taps/hand-write-events.json
  - raw/tsugigami-20261028-1535.json
  - raw/tsugigami-20261028-1519.json
  - raw/2026-10-30_lab_aa-live-vs-tile.md
  - raw/2026-11-10_鋭い折り返しの欠けと拡大時のガタつき.md
---

# iPad の Safari は合体イベントつきの pointermove を 2 回届ける

確度: lab の記録(本物の Pencil、iPad、Safari 27.0.1)と、実機で書いて書き出した JSON で確認。**なぜ 2 回なのか**(Safari の不具合か、仕様の解釈か)は分からない。

## 分かったこと

Pencil の pointermove は、**同じ時刻・同じ合体イベントの列を持ったものが、続けてもう 1 回届く**。2 回目は 1 回目の完全な複製。

| 記録 | Pencil の move | 直前と同じものが繰り返された回数 | 合体イベントが 2 個以上の move のうち、繰り返されたもの |
|---|---|---|---|
| 2026-10-30 議事録(`minutes-events.json`) | 7,014 | 3,325 | 3,023 中 2,815 |
| 2026-10-30 手を置いて書く(`hand-write-events.json`) | 430 | 198 | 217 中 190 |
| 2026-10-28 ゆっくり横線(lab-results のみ、raw に無い) | 1,566 | 766 | 795 中 763 |

(2026-11-10 追記: 3 行目の記録は [raw/2026-10-30_lab_aa-live-vs-tile/](../../raw/2026-10-30_lab_aa-live-vs-tile.md) に写した。)

合体イベントが 1 個だけの move はほとんど繰り返されない(議事録で 510 回)。繰り返しを除くと、合体イベントの時刻が前の move より戻ることは 1 度も無い。

記録は lab の `record()`(window の capture で 1 つだけ聞いている)なので、記録する側の二重登録ではない。本体も同じものを 2 回受けていた証拠が、保存された点列に残っている(下)。

## 本体で何が起きていたか

[controller.ts](../../src/controller.ts) の `onMove` は合体イベントの点を順に足し、直前の点と 0.3 画素未満しか離れていない点だけ捨てていた。2 回目の列の先頭は 1 回目の列の末尾と離れているので、**列がまるごともう一度足される**。線は数点ぶん後戻りして、同じ所をなぞり直す。

2026-10-28 15:35 に書き出した JSON(15:19 の分を含む)では、129 本中 127 本にこのなぞり直しがあり、点の **45%**(8,789 点中 3,935 点)がなぞり直しだった。例(z=102 の書き始め、格子の間隔を 1 とした x): `… -1, 1, -1, 1, 3, 5, 3, 5, 8, 11, 8, 11, 14, 17, 14, 17 …`。

なぞり直しは同じ道をたどるので、ほとんどの所では見た目が変わらない。ただ、線の中に 180° の折り返し(しかも 2 次曲線の中の尖り)をたくさん作る。[鋭い折り返しで線が欠ける](../../raw/2026-11-10_鋭い折り返しの欠けと拡大時のガタつき.md) こととの関係は未確認(Linux の Chromium / WebKit では欠けない。iPad での確認は lab 実験 `experiments/sharp-turns.js` に頼んだ)。

[線のガタつきの計測](線のガタつきの計測.md) で「書き始めに点の固まりとフックがある」「点の間隔 0.4 px」としていたものの一部は、このなぞり直しを数えていた(2026-11-10 にそのページへ追記)。

## 対処(2026-11-10)

- **入力**: 合体イベントの時刻が、その線で最後に受け付けた点より前なら捨てる([controller.ts](../../src/controller.ts) の `onMove`)。同じ時刻の点は、直前の点との距離の判定で落ちる。lab の合成入力は同じ時刻の点を続けて送ることがあるので、「同じ時刻」では捨てない。
- **描画**: 既に保存してある線は、直前の k 点(k ≥ 2)をそっくり繰り返している所を描くときに除く([smooth.ts](../../src/smooth.ts) の `dropReplays`)。**保存してある点列は変えない**(書いたものを守る。戻せない変換をしない)。

自動テスト: `tests/smooth.test.ts`(実機の JSON で 9 割以上の線になぞり直しがあること、除き方)、`e2e/app.spec.ts`「同じ合体イベントの列が 2 回届いても、線は後戻りしない」(直す前のコードでは失敗することを確かめた)。

## 確かめ方(記録から数える)

```
python3 - <<'EOF'
import json
evs = json.load(open('raw/2026-10-30_lab_palm-rest/minutes-events.json'))
pen = [e for e in evs if e.get('pt') == 'pen' and e['type'] == 'pointermove' and e.get('buttons')]
print(len(pen), sum(1 for a, b in zip(pen, pen[1:]) if a['t'] == b['t'] and a.get('co') == b.get('co')))
EOF
```

## Sources

- [raw/2026-10-30_lab_palm-rest/minutes-events.json](../../raw/2026-10-30_lab_palm-rest/minutes-events.json)、[raw/2026-10-30_lab_taps/hand-write-events.json](../../raw/2026-10-30_lab_taps/hand-write-events.json)(`t` と `co`)
- [raw/tsugigami-20261028-1535.json](../../raw/tsugigami-20261028-1535.json)、[raw/tsugigami-20261028-1519.json](../../raw/tsugigami-20261028-1519.json)(保存された点列)
- [src/controller.ts](../../src/controller.ts)、[src/smooth.ts](../../src/smooth.ts)
