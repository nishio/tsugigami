---
title: Kozaneba との関係
type: theme
created: 2026-10-27
updated: 2026-10-27
sources:
  - raw/2026-10-27_Notability置き換えの要件会話.md
  - raw/2026-10-27_実機での最初の感想とissue1.md
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

## 連携を考える(2026-10-27、検討中)

nishio が「Kozanebaとの連携について考えたいね」と言った([raw](../../raw/2026-10-27_実機での最初の感想とissue1.md))。以下はその下調べ。【事実】はソースかコードで確かめたこと、【推測】はこちらの考え。まだ何も決めていない。

### それぞれが受け持つところ

- 【事実】nishio は以前から、時間的スキームとコンテキスト的スキームを行き来できるのが理想だと書いている。断片の意味が分からないときは、それが出てきた時間の流れを見に戻りたい、という話(Kozaneba wiki の `concepts/時間的スキーム.md`)。
- 【推測】ここから、tsugigami = 書いた順(時間)、Kozaneba = 関係(空間)という分業になる。往復できることに価値がある。
- 【事実】Kozaneba wiki には、こざねに「源の長文」(Situation)が無いという整理がある。1 つの長文から N 個のこざねが生える、という実体の捉え方(`concepts/源の長文.md`)。
- 【推測】手書きのページは、この「源の長文」の役を担える。
- 【事実】手書きと Kozaneba 系の過去の接点:
  - Regroup の時代、iPad で Pencil を使うと手書きの書き込みになる仕様だった(Kozaneba wiki の raw: `2020-12-23__頭を整理するツール.md`)。
  - Kozaneba には柔らかく囲う機能が無いので、Kozaneba のスクリーンショットを Notability で囲んでいた(`2022-12-13__西尾の我流に名前をつける.md`)。

### Kozaneba の今の作りで、外から入れられるもの【事実、kozaneba f7c9177】

- 要素は `kozane / group / scrapbox / gyazo` の 4 種(`src/Global/TItem.ts`)。画像は `gyazo` 型で、任意の URL の画像を表示する。
- 貼り付けはテキストだけを受ける(`src/App/onPaste.tsx`、`navigator.clipboard.readText`)。
  - `https://gyazo.com/` で始まるか `.png` で終わる URL → 画像のこざね
  - その他の http(s) → URL 付きのこざね
  - `{"format":"Kozaneba","version":4}` の JSON → まとめて取り込む
  - 画像を blob のまま貼る経路は無い。
- 特定の要素への深いリンクは無い(URL は `#edit=` / `#view=` だけ)。

### 連携の形(価値が高く、手間が小さい順)【推測】

1. **投げ縄で選んだ手書きを、画像のこざねとして送り、元の場所へ戻るリンクを付ける。**
   - tsugigami 側: 選択範囲を PNG にして画像ホストに上げ、Kozaneba v4 の JSON をクリップボードに載せる。
   - Kozaneba 側はほぼ改造しなくてよい。
   - 「源の長文」と時間軸への往復が一番安く手に入る。ただし画像を置く場所が要る。
2. **戻り道のリンクだけ先に作る。** tsugigami に「ノート + 位置」を指す URL(hash)を足す。Kozaneba のこざねに URL として貼れば、Visit で元の手書きに戻れる。
3. **手書きを文字にして、テキストのこざねにする。** OCR か LLM の画像認識を使う。検索やマージができるが、手段と API キーの置き場所が重い。
4. **Kozaneba の配置を tsugigami の紙に背景として敷き、手で囲む・書き込む。** Notability でしていたことの置き換えになる。ただし tsugigami に画像の層が要る。
5. **Kozaneba に手書きのこざねを持たせる**(Regroup への回帰)。新しい要素の型が要るので重い。
6. **保存先を共有する・同期する。** 今はやらない。

### nishio に聞きたいこと

1. 欲しいのはどちら向きか。手書きを Kozaneba で並べ替えたいのか、Kozaneba の配置に手で書き込みたいのか。具体的な場面を一つ。
2. こざねになった手書きは、画像のままでよいか。検索やマージのために文字が要るか。
3. 画像を置く場所に Gyazo などの外部サービスを使ってよいか(私的なノートの断片が外に出る)。
4. これは今の Kozaneba を改造する話か。tsugigami を新しいものの部品(源の長文を書く帳面)として育てる話か。

## Sources

- [raw/2026-10-27_Notability置き換えの要件会話.md](../../raw/2026-10-27_Notability置き換えの要件会話.md)
- [raw/2026-10-27_実機での最初の感想とissue1.md](../../raw/2026-10-27_実機での最初の感想とissue1.md)
- Kozaneba の設計 wiki `~/kozaneba-dev-ai/wiki/`(`concepts/時間的スキーム.md`、`concepts/源の長文.md`、`concepts/一次元化.md`)と、コード `~/kozaneba-dev-ai/work/kozaneba/`
