---
title: Index
type: meta
created: 2026-10-27
updated: 2026-10-27
---

# tsugigami 開発 wiki

LLM が書いて育てる開発 wiki。運用ルールは [CLAUDE.md](../CLAUDE.md)、時系列は [log.md](log.md)。

## 全体

- [tsugigami の全体像](overview.md) — 何か、なぜ作るか、現在地、コードの構成
- [要件](requirements.md) — nishio の発言から合成した要件と実装状況

## concepts/

- [継ぎ紙モデル](concepts/継ぎ紙モデル.md) — A4 縦を下へ継ぎ、ページ単位で右へ継ぎ足す紙のかたち
- [縦スクロールの時間軸](concepts/縦スクロールの時間軸.md) — 1 次元に並べると書いた順が暗黙の整理軸になる
- [手のひら判定](concepts/手のひら判定.md) — 指では描かない、ペンの近くと直後のタッチを無視する
- [描画の層とタイル](concepts/描画の層とタイル.md) — base / live / wet の 3 層、タイルキャッシュ、ペン先の遅れを縮める工夫

## decisions/

- [PWA として GitHub Pages に置く](decisions/2026-10-27_PWAとGitHub_Pages.md) — 次の起動で新版に切り替わる Service Worker
- [UI フレームワークを使わない](decisions/2026-10-27_フレームワークを使わない.md) — 描画のホットパスに何も挟まない
- [線 1 本ずつ IndexedDB へ保存する](decisions/2026-10-27_線ごとにIndexedDBへ保存.md) — 差分保存で書いたものを失わない
- [同期は後回しにして、バックアップで守る](decisions/2026-10-27_同期は後回し_バックアップで守る.md) — 書き出し・読み込み・7 日の警告・persist
- [横の継ぎ足しはページ単位にする](decisions/2026-10-27_横の継ぎ足しはページ単位.md) — 「その箇所だけ右に広がる」の実現方法

## findings/

- [hidden 属性は display の指定に負ける](findings/hidden属性とdisplay指定.md) — 自動テストで確認
- [claude.ai の Artifact では試作しかできない](findings/Artifactでは試作しかできない.md) — 文書・仕様による
- [合成した PointerEvent でペン入力をテストする](findings/合成PointerEventでのテスト.md) — 自動テストで確認
- [Service Worker のキャッシュが当たらない 2 つの罠](findings/ServiceWorkerのキャッシュ照合.md) — addAll の重複と Vary。自動テストで確認
- [長いノートの描画性能(ヘッドレスでの計測)](findings/長いノートの描画性能_ヘッドレス計測.md) — 9,900 本で計測、全体の焼き直しを避けた
- [iPad の Web アプリでできないこと・怪しいこと](findings/iPadとWebの制約.md) — 未確認の一覧
- [レビューで見つかった端のケース](findings/レビューで見つかった端のケース.md) — イベントの取りこぼし、読み込みの原子性など 10 件を修正

## themes/

- [実機でしか分からないこと](themes/実機でしか分からないこと.md) — nishio に確かめてほしい項目と状態
- [Kozaneba との関係](themes/Kozanebaとの関係.md) — 1 次元と 2 次元、対になる論点

## raw/

- [2026-10-27 Notability 置き換えの要件会話](../raw/2026-10-27_Notability置き換えの要件会話.md)
