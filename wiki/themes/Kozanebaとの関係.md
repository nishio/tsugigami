---
title: Kozaneba との関係
type: theme
created: 2026-10-27
updated: 2026-10-27
sources:
  - raw/2026-10-27_Notability置き換えの要件会話.md
---

# Kozaneba との関係

tsugigami は Kozaneba(nishio の「かんがえをまとめるデジタル文房具」)とは別のものとして始めた。nishio 自身「関連するようで少し関連の遠い話」と言っている。Kozaneba の設計知識は別リポジトリ `~/kozaneba-dev-ai/` の LLM Wiki にある。

## 対になっている論点

| | tsugigami | Kozaneba |
|---|---|---|
| 空間 | 1 次元(縦)+ 局所的な横の継ぎ足し | 2 次元の自由配置 |
| 整理軸 | 書いた順(時間)が暗黙に効く | 位置と囲みで関係を表す |
| 単位 | 手書きの線 | こざね(短い文字の断片) |

「1 次元は時間軸という整理軸がタダで手に入る」([縦スクロールの時間軸](../concepts/縦スクロールの時間軸.md))は、Kozaneba の「なぜ 2 次元にするのか」を考える材料になる。必要なら Kozaneba の wiki の themes/ への反映を提案する。

## 将来つながりうるところ

- 手書きの断片を投げ縄で選んで、Kozaneba のこざねとして持っていく。
- ストロークを「id 付きの追加・削除・置換」で扱う tsugigami の構造は、Kozaneba の要素の扱いと比べる価値がある。

## Sources

- [raw/2026-10-27_Notability置き換えの要件会話.md](../../raw/2026-10-27_Notability置き換えの要件会話.md)
