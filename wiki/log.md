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
