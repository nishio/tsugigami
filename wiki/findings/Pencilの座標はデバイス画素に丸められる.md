---
title: iPad の Safari が渡す Pencil の座標はデバイス画素(0.5 CSS px)に丸められている
type: finding
confidence: 実機で確認
created: 2026-11-10
updated: 2026-11-10
sources:
  - raw/2026-10-30_lab_palm-rest/minutes-events.json
  - raw/2026-10-30_lab_taps/hand-write-events.json
  - raw/tsugigami-20261028-1535.json
  - raw/tsugigami-20261028-1519.json
  - raw/2026-11-10_鋭い折り返しの欠けと拡大時のガタつき.md
---

# Pencil の座標はデバイス画素に丸められている

確度: lab の記録と実機で書いた JSON で確認。Pencil 自体はもっと細かい位置を測っている(UIKit の `preciseLocation`)はずだが、Web から細かい値を取る方法は見つけていない(推測。探してもいない)。

## 分かったこと

- lab の記録で、Pencil の合体イベントの `clientX`・`clientY` は **すべて 0.5 の倍数**(議事録 8,427 点、手を置いて書く 904 点の 100%)。画素比 2 なので、1 デバイス画素の格子。
- 保存した点列(ノート座標)では、隣り合う点の差がほぼすべて **0.41〜0.42 の整数倍**。書いたときの倍率 1.19〜1.22 で 0.5 CSS px を割った値(1 / (倍率 × 2))。

## 何が起きるか

書いたときの 1 デバイス画素より細かい位置は失われている。fit で書いた線は、ノート座標で約 0.42 刻みの格子の上にある。

- fit のままなら格子は 1 デバイス画素なので見えない。
- **拡大すると格子が階段として見える。** 4 倍に拡大すると 1 段が 4 デバイス画素。水平・垂直に近い線ほど段が長く、はっきり見える(nishio「水平に近い短い線を描いてから拡大した時にガタガタしている」2026-11-10)。
- 点が密(0.4〜1.5 px 間隔)なので、中点を結ぶ 2 次曲線で描いても階段はほとんどならされない。

## 対処

描くときに、書いたときの格子の幅に比例して平滑化する([判断](../decisions/2026-11-10_平滑化は書いたときの画素の幅で.md))。格子の幅は点列から推定する(保存の形は変えない)。

## Sources

- [raw/2026-10-30_lab_palm-rest/minutes-events.json](../../raw/2026-10-30_lab_palm-rest/minutes-events.json)、[raw/2026-10-30_lab_taps/hand-write-events.json](../../raw/2026-10-30_lab_taps/hand-write-events.json)(`co` の座標)
- [raw/tsugigami-20261028-1535.json](../../raw/tsugigami-20261028-1535.json)、[raw/tsugigami-20261028-1519.json](../../raw/tsugigami-20261028-1519.json)
- [src/smooth.ts](../../src/smooth.ts) の `latticeStep`、[tests/smooth.test.ts](../../tests/smooth.test.ts)(実機の JSON で 9 割以上の線に 0.39〜0.43 の格子が見つかる)
