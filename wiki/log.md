---
title: Log
type: meta
created: 2026-10-27
updated: 2026-10-27
---

時系列の作業ログ。append-only。見出しは `## [YYYY-MM-DD] <action> | <subject>`(`grep "^## \[" wiki/log.md` で一覧できる)。

## [2026-10-27] ingest | Notability 置き換えの要件会話

- kozaneba-dev-ai のセッションでの nishio の発言を [raw](../raw/2026-10-27_Notability置き換えの要件会話.md) に保存。
- [要件](requirements.md)、[継ぎ紙モデル](concepts/継ぎ紙モデル.md)、[縦スクロールの時間軸](concepts/縦スクロールの時間軸.md) を作成。
- 書き味テスト(claude.ai Artifact)を [spike/](../spike/pencil-ink-test.html) に保存。実機確認は nishio が後で行う。

## [2026-10-27] develop | M0 骨組みと M1 明日から使える版

- Vite + TypeScript(フレームワークなし)、Service Worker の自動生成、GitHub Pages への自動公開を用意。
- ペン・マーカー・線消しゴム・投げ縄と変形・貼り付け・方眼・ページの右への継ぎ足し・ノート一覧とゴミ箱・バックアップを実装。
- 単体テスト 18 件、e2e 20 件(WebKit / Chromium)が通過。e2e で `hidden` 属性が効かない問題を発見して修正([finding](findings/hidden属性とdisplay指定.md))。
- 判断 5 件、概念 4 件、finding 4 件、テーマ 2 件を記録。

## [2026-10-27] develop | 公開、オフライン起動と長いノートの性能

- GitHub(nishio/tsugigami、公開)に push し、GitHub Pages への自動公開が通った。
- オフライン起動の e2e で Service Worker の罠を 2 つ発見(`addAll` の重複、`Vary` による照合外れ)して修正([finding](findings/ServiceWorkerのキャッシュ照合.md))。
- 9,900 本の長いノートで計測し、ページ自動追加のたびの全体焼き直しを解消、書き終わった線を輪郭の `Path2D` キャッシュで描く方式に変更、先読みと書いている間の合成保留を追加([finding](findings/長いノートの描画性能_ヘッドレス計測.md))。
- 慣性スクロールの速度に上限を設けた(イベント間隔が極端に短いと跳ねていた)。

## [2026-10-27] develop | 回転への追従と公開版の確認

- 画面幅が変わったとき(回転・Split View)、紙が幅に合っていたなら合わせ直す。見ていた位置は保つ。e2e を追加。
- 公開版(GitHub Pages)に対して e2e の一部(保存・消しゴム・マーカー・オフライン起動)を流せる設定 `playwright.prod.config.ts` を追加し、通過を確認。本番の応答は `Vary: Accept-Encoding`、`cache-control: max-age=600`。

## [2026-10-27] develop | 長いノートの移動と、書きかけで固まる問題の予防

- 右端にスクロールのつまみを追加。掴んで動かすと「n / m ページ」を出す。縦に長く継ぐノートでは指のスクロールだけでは遠い所へ行きにくいため([縦スクロールの時間軸](concepts/縦スクロールの時間軸.md) の「時間軸をたどる」手段)。
- pointermove / up / cancel を window で受けるようにした。ポインタのキャプチャが効かずにステージの外で離されると、書きかけ(合成保留)のまま固まる恐れがあった。e2e を追加。
- ヘッドレス WebKit ではタイルの焼き込みが 1 秒に十数枚しか進まない(rAF の間引きとソフトウェア描画のため)。開いた直後に線が少し遅れて出る程度の影響。実機の速さは未確認。

## [2026-10-27] develop | 別の目によるレビューと端のケースの修正

- コードだけを渡したレビューで、端のケースを 10 件発見(通常の流れは問題なし)。全部修正し、うち 2 件は e2e を追加([finding](findings/レビューで見つかった端のケース.md))。
- 主なもの: バックアップ読み込みの原子化、離すイベントの取りこぼしで固まらない、書き始めたノートに線を入れる、共有シートが失敗したらダウンロードに切り替える、2 本指タップの取り消しを 250ms 遅らせて手のひらと区別。
