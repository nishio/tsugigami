---
title: Index
type: meta
created: 2026-10-27
updated: 2026-10-30
---

# tsugigami 開発 wiki

LLM が書いて育てる開発 wiki。運用ルールは [CLAUDE.md](../CLAUDE.md)、時系列は [log.md](log.md)。

## 全体

- [tsugigami の全体像](overview.md) — 何か、なぜ作るか、現在地、コードの構成
- [要件](requirements.md) — nishio の発言から合成した要件と実装状況

## concepts/

- [継ぎ紙モデル](concepts/継ぎ紙モデル.md) — A4 縦を下へ継ぎ、ページ単位で右へ継ぎ足す紙のかたち
- [縦スクロールの時間軸](concepts/縦スクロールの時間軸.md) — 1 次元に並べると書いた順が暗黙の整理軸になる
- [手のひら判定](concepts/手のひら判定.md) — 指では描かない、ペンの近くと直後のタッチを無視する、3 点以上と pointercancel は手。規則は実機の記録の再生で確かめる
- [描画の層とタイル](concepts/描画の層とタイル.md) — base / live / wet の 3 層、タイルキャッシュ、ペン先の遅れを縮める工夫
- [書いたものを守る層](concepts/書いたものを守る層.md) — 線 1 本が GitHub の履歴まで届く道筋、再試行・commit の作り方・消さない規則、失い方ごとに残るもの

## decisions/

- [PWA として GitHub Pages に置く](decisions/2026-10-27_PWAとGitHub_Pages.md) — 次の起動で新版に切り替わる Service Worker
- [UI フレームワークを使わない](decisions/2026-10-27_フレームワークを使わない.md) — 描画のホットパスに何も挟まない
- [線 1 本ずつ IndexedDB へ保存する](decisions/2026-10-27_線ごとにIndexedDBへ保存.md) — 差分保存で書いたものを失わない
- [同期は後回しにして、バックアップで守る](decisions/2026-10-27_同期は後回し_バックアップで守る.md) — 書き出し・読み込み・7 日の警告・persist(superseded)
- [GitHub の非公開 repo へ自動でバックアップする](decisions/2026-10-27_GitHubの非公開repoへ自動バックアップ.md) — 手を止めるたびに commit、手元に無いものは消さない
- [横の継ぎ足しはページ単位にする](decisions/2026-10-27_横の継ぎ足しはページ単位.md) — 「その箇所だけ右に広がる」の実現方法
- [見た目と書き味を Notability での設定に合わせる](decisions/2026-10-27_Notabilityの書き味に合わせる.md) — issue #1。筆圧なし、見本から採った色と太さ
- [置いた手は紙を動かさない。ペンが遅れて来ても戻す](decisions/2026-10-30_置いた手は動かさない_遅れたペンでも戻す.md) — superseded。推測で書いた 3 規則、同日に取り下げ
- [手の群れと pointercancel で手のひらを見分ける](decisions/2026-10-30_手の群れとpointercancelで見分ける.md) — iPad の記録から。同時 3 点以上・pointercancel は手、戻して 300ms 無視。残る穴は 2 本指タップの誤爆
- [iPad 自身を実験機にする](decisions/2026-10-28_iPad自身を実験機にする.md) — `?lab=1` で開いた本物のアプリが、非公開 repo の experiments/queue/ のスクリプトを拾って実行し、結果を commit する。AI 側は `tools/lab.mjs`

## findings/

- [hidden 属性は display の指定に負ける](findings/hidden属性とdisplay指定.md) — 自動テストで確認
- [claude.ai の Artifact では試作しかできない](findings/Artifactでは試作しかできない.md) — 文書・仕様による
- [合成した PointerEvent でペン入力をテストする](findings/合成PointerEventでのテスト.md) — 自動テストで確認
- [Service Worker のキャッシュが当たらない 2 つの罠](findings/ServiceWorkerのキャッシュ照合.md) — addAll の重複と Vary。自動テストで確認
- [長いノートの描画性能(ヘッドレスでの計測)](findings/長いノートの描画性能_ヘッドレス計測.md) — 9,900 本で計測、全体の焼き直しを避けた
- [iPad の Web アプリでできないこと・怪しいこと](findings/iPadとWebの制約.md) — 未確認の一覧
- [レビューで見つかった端のケース](findings/レビューで見つかった端のケース.md) — イベントの取りこぼし、読み込みの原子性など 10 件を修正
- [Notability のマーカーの重なりは乗算](findings/マーカーの重なりは乗算.md) — 見本の画素から推定し、e2e で再現を確認
- [iPad の Safari では IndexedDB との接続が切れることがある](findings/SafariのIndexedDB接続切れ.md) — 文書・仕様による。開き直して再試行する
- [GitHub へのバックアップの実測](findings/GitHubへのバックアップの実測.md) — 本物の API(CORS・空の repo)と、長いノートで送る量と時間
- [線のガタつきを数値で比べる](findings/線のガタつきの計測.md) — 実機で確認。保存された点列は Notability と同等に滑らか。ガタつきの正体は、書いている最中に区間を足していくライブ層の描き方で縁のアンチエイリアスが潰れること(Chromium で再現)。iPad でペンを離した後も残る理由は実機で切り分け待ち。道具は `tools/wobble.py`、`e2e/render-json.spec.ts`、`e2e/render-live.spec.ts`

- [置いた手は短いタッチの群れとして届く(iPad の記録)](findings/置いた手は短いタッチの群れとして届く.md) — 実機で確認。書いている間は iPadOS が止めている。手は 3〜12 点・中央値 43ms の群れ、半分は pointercancel。ピンチ・スクロールは 2 点以下、cancel 0。動き出しの速さでは分けられない

## themes/

- [実機でしか分からないこと](themes/実機でしか分からないこと.md) — nishio に確かめてほしい項目と状態
- [Kozaneba との関係](themes/Kozanebaとの関係.md) — 1 次元と 2 次元、対になる論点。連携の形の下調べと質問。Kozaneba を作り直すなら、手書きは Source になり、保存は tsugigami と同じ GitHub repo の形に(2026-10-27)

## raw/

- [2026-10-27 Notability 置き換えの要件会話](../raw/2026-10-27_Notability置き換えの要件会話.md)
- [2026-10-27 実機での最初の感想と issue #1](../raw/2026-10-27_実機での最初の感想とissue1.md)(見本の画像 [png](../raw/2026-10-27_issue1_テイスト.png))
- [2026-10-27 消えないと信じられること](../raw/2026-10-27_消えないと信じられること.md)
- [2026-10-28 線がガタガタしている](../raw/2026-10-28_線がガタガタ.md)
- [2026-10-28 issue #2 と書き出した JSON](../raw/2026-10-28_issue2_線がガタガタ.md)(画像 [png](../raw/2026-10-28_issue2_線がガタガタ.png)、[json](../raw/tsugigami-20261028-1519.json))
- [2026-10-28 AI が Safari で実験できるようにしたい](../raw/2026-10-28_AIがSafariで実験.md)
- [2026-10-28 両方のアプリでゆっくり直線を引いた比較](../raw/2026-10-28_issue2_直線の比較.md)([tsugigami](../raw/2026-10-28_issue2_直線_tsugigami.png)、[Notability](../raw/2026-10-28_issue2_直線_Notability.png)、[json](../raw/tsugigami-20261028-1535.json))
- [2026-10-30 議事録で使った感想: パームの後判定での拡大縮小のずれ](../raw/2026-10-30_議事録で使った感想_パーム後判定の拡縮ずれ.md)
- [2026-10-30 手のひらの判定は想像ではなくデータを集めるべき](../raw/2026-10-30_想像ではなくデータを集めるべき.md)
- [2026-10-30 lab: 置いた手・ピンチ・スクロール・議事録のタッチの記録](../raw/2026-10-30_lab_palm-rest.md)([記録](../raw/2026-10-30_lab_palm-rest/))
