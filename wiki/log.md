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
