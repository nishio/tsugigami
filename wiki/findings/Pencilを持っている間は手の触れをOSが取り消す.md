---
title: Pencil を持っている間は、手の触れを iPadOS が取り消す(見立て)
type: finding
created: 2026-10-31
updated: 2026-10-31
confidence: 未確認
sources:
  - raw/2026-10-30_lab_palm-rest.md
  - raw/2026-10-30_lab_taps.md
---

# Pencil を持っている間は、手の触れを iPadOS が取り消す(見立て)

## 記録で確かめたこと(実機で確認)

| 場面 | 届いた手の触れ | 終わり方 |
|---|---|---|
| 議事録を Pencil で書く 150 秒(手は置きっぱなし) | 7 本 | 6 本 pointercancel |
| Pencil を手に持ったまま、手を置いてすぐ離す × 5 | 2 点 × 2 回 | すべて pointercancel |
| 手を置いて Pencil で線を書く × 5 | 2 点 × 1 回(125ms) | pointercancel。離れて 13ms 後にペンが着地 |
| Pencil を置いて、手だけ置く 14 秒 | 158 本 | 85 本 pointercancel、残りは pointerup |

Pencil を手に持っていた 3 つの場面では、届いた手の触れは**すべて**取り消された。取り消されない触れが混じったのは、Pencil を置いて手だけを乗せたときだけ。

## 見立て(未確認)

**Pencil が画面の近くにあると、iPadOS 自身の手のひら判定が働き、手の触れはアプリに届く前に取り消される。** Pencil が離れている(机に置いた、考えている)間だけ、手の触れが素通りしてくる。

記録と矛盾しないが、OS の仕様として確かめてはいない。別の説明もありうる: Pencil を持っているときの手の置き方(小指側から着く)が、持っていないときと違うだけかもしれない。

## 設計への意味

- 「書いている最中の手のひら」は OS が面倒を見ている。アプリが相手にするのは、**Pencil を置いた・離した間の手**。
- だから pointercancel は「OS が手と判断した」合図として使える([判断](../decisions/2026-10-30_手の群れとpointercancelで見分ける.md) の規則 2)。
- 確かめるなら: Pencil を机に置いた状態と、手に持った(先を付けない)状態で、同じ置き方を繰り返して pointercancel の割合を比べる。lab の `experiments/taps.js` の hand-touch の段を、Pencil 無しでも繰り返せば足りる。

## Sources

- [raw/2026-10-30_lab_palm-rest.md](../../raw/2026-10-30_lab_palm-rest.md)、[raw/2026-10-30_lab_taps.md](../../raw/2026-10-30_lab_taps.md)
- [置いた手は短いタッチの群れとして届く](置いた手は短いタッチの群れとして届く.md)、[タップと手の触れは長さと cancel でしか分けられない](タップと手の触れは長さとcancelでしか分けられない.md)
