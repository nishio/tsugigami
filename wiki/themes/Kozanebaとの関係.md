---
title: Kozaneba との関係
type: theme
created: 2026-10-27
updated: 2026-10-27
sources:
  - raw/2026-10-27_Kozaneba作り直しでのtsugigami.md
  - raw/2026-10-27_Notability置き換えの要件会話.md
  - raw/2026-10-27_実機での最初の感想とissue1.md
  - raw/2026-10-27_消えないと信じられること.md
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

### nishio の答え(2026-10-27)

> 手書きをKozanebaで並べ替えたい、画像のままでいい、ただ、いますぐやることではない。さきにここに書いたものが消えないと信じられることが安心して日常のノートを切り替えるために必要

- 向き: 手書き → Kozaneba で並べ替える(上の 1 番の形に近い)。
- 画像のままでよい(文字にしなくてよい)。
- 今すぐではない。先に [書いたものを守る層](../concepts/書いたものを守る層.md) を固めた。
- 画像の置き場所は未定。GitHub の非公開 repo は画像を公開の URL で出せないので、**今の** Kozaneba の `<img src>` にはそのまま使えない(Gyazo などの外部か、別の置き場が要る)。【推測】作り直す場合は、この問題自体が消える(次の節)。

### Kozaneba を作り直す場合の位置づけ(2026-10-27)

Kozaneba の wiki で「互換性を全部捨てて作り直すなら」を考えた([raw](../../raw/2026-10-27_Kozaneba作り直しでのtsugigami.md))。考察の本体は Kozaneba wiki の [互換性を捨てた作り直し](../../../kozaneba-dev-ai/wiki/themes/互換性を捨てた作り直し.md)。

### nishio が決めたこと

> 同時編集は要件ではない。Firebaseに残る必要はない。tsugigamiはソースになり得る

- 上の「最初に聞いたこと」の 4(今の Kozaneba の改造か、新しいものの部品か)への答えに近い。**作り直す Kozaneba では、tsugigami の手書きは Source(源の長文)の一種になる。**

### 作り直す Kozaneba の保存は、tsugigami と同じ形になる【推測】

- 同時編集が要らず Firebase を離れてよいので、作り直す Kozaneba の保存は tsugigami の [GitHub の非公開 repo へ自動バックアップ](../decisions/2026-10-27_GitHubの非公開repoへ自動バックアップ.md) と同じ形を提案した。
  - 手元は IndexedDB で、正本は GitHub の非公開 repo。手が止まったら自動で commit する。サーバは持たない。
  - tsugigami で確かめた次のことを、そのまま前提にしている。
    - ブラウザから git data API を直接呼べる(CORS)。
    - 空の repo では 409 になる。
    - ref を `force: false` で進めてやり直す。
    - 手元に無いものは消さない。

### 手書きを Source にするときの形【推測】

- **こざねは、tsugigami-notes の版を固定して手書きを指す。** 例: `{repo: nishio/tsugigami-notes, commit, note id, 線の id の並び(または範囲)}`。
  - 線は書いた後に変わらず、id を持つ([model.ts](../../src/model.ts) の `Stroke.id`、[実測](../findings/GitHubへのバックアップの実測.md))。
  - そのため、範囲より線の id で指す方が丈夫そう。消しゴムで消しても、commit を固定していれば元の線は読める。
- **画像の置き場所が要らなくなる。** 作り直す Kozaneba が、同じ fine-grained token(2 つの repo に効かせる)で `notes/<id>/p0001.json` を読み、該当する線を直接描けばよい。PNG にして外部ホストに上げる必要がない。
  - 線を描く処理は、tsugigami と共有できるかもしれない。
- **戻り道**: こざねから tsugigami の該当ノートの該当位置へ飛ぶ。上の連携案 2(「ノート + 位置」を指す URL)が、作り直しの場合も要る。

### tsugigami 側に効く制約

- **repo のファイルの形が、tsugigami の外への約束になる。** Kozaneba が `p0001.json` を読むなら、その形を変えると Kozaneba 側も壊れる。CLAUDE.md の「古い形を読めるようにしておく」は、自分の履歴のためだけでなく、Kozaneba の読み手のためにも要る。
- 線の id は、一度付けたら変えない。

### まだ決めていないこと

- Kozaneba のデータを tsugigami-notes と同じ repo に置くか、別の repo にするか。
- 今すぐやることではない、という nishio の判断(上の節)は変わっていない。作り直しに進むかどうか自体も未定。

## 最初に聞いたこと

1. 欲しいのはどちら向きか。手書きを Kozaneba で並べ替えたいのか、Kozaneba の配置に手で書き込みたいのか。具体的な場面を一つ。
2. こざねになった手書きは、画像のままでよいか。検索やマージのために文字が要るか。
3. 画像を置く場所に Gyazo などの外部サービスを使ってよいか(私的なノートの断片が外に出る)。
4. これは今の Kozaneba を改造する話か。tsugigami を新しいものの部品(源の長文を書く帳面)として育てる話か。

## Sources

- [raw/2026-10-27_Kozaneba作り直しでのtsugigami.md](../../raw/2026-10-27_Kozaneba作り直しでのtsugigami.md)
- Kozaneba wiki の [互換性を捨てた作り直し](../../../kozaneba-dev-ai/wiki/themes/互換性を捨てた作り直し.md)

- [raw/2026-10-27_Notability置き換えの要件会話.md](../../raw/2026-10-27_Notability置き換えの要件会話.md)
- [raw/2026-10-27_実機での最初の感想とissue1.md](../../raw/2026-10-27_実機での最初の感想とissue1.md)
- [raw/2026-10-27_消えないと信じられること.md](../../raw/2026-10-27_消えないと信じられること.md)
- Kozaneba の設計 wiki `~/kozaneba-dev-ai/wiki/`(`concepts/時間的スキーム.md`、`concepts/源の長文.md`、`concepts/一次元化.md`)と、コード `~/kozaneba-dev-ai/work/kozaneba/`
