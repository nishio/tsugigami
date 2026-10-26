## このリポジトリの目的

nishio が iPad + Apple Pencil で毎日使う手書きノートを、Web 技術(PWA)で自作する。Notability の置き換えが当面の目標。
あわせて、開発過程で得た知見(設計判断、Safari / iPadOS の挙動、実機で測った値、失敗と後悔)を LLM が育てる wiki に蓄積する。wiki の設計思想は Karpathy の「LLM Wiki」パターン(生ソースは不変、wiki は LLM が書く、このファイルがスキーマ)に従う。

名前の由来: 継ぎ紙(つぎがみ)。A4 を縦に継ぎ足して 1 本の帳面にし、必要な箇所だけ右へ紙を継ぎ足せる、という設計をそのまま表す。

## ディレクトリ構成

```
.
├── CLAUDE.md            このファイル(スキーマ兼開発ルール)
├── README.md            利用者向けの説明
├── index.html, src/     アプリ本体(TypeScript + Vite、フレームワークなし)
├── public/              manifest、アイコン(Service Worker はビルド時に生成)
├── tests/               Vitest の単体テスト
├── tools/               アイコン生成などの補助スクリプト
├── spike/               本体に入る前の実験コード(書き味テストなど)。参照用に残す
├── raw/                 一次資料(不変)。nishio の発言、実機での計測結果、外部記事のクリップ
└── wiki/                LLM 管理レイヤ
    ├── index.md         全ページのカタログ
    ├── log.md           時系列の作業ログ(append-only)
    ├── overview.md      tsugigami の全体像と現在地
    ├── requirements.md  要件(nishio の発言から合成)
    ├── concepts/        概念(継ぎ紙モデル、手のひら判定、描画遅延、…)
    ├── decisions/       設計判断。1 判断 1 ページ。何を選び、何を捨て、なぜか
    ├── findings/        開発中に分かった事実。ブラウザの挙動、計測値、ハマりどころ
    └── themes/          横断的な考察(Kozaneba との関係、繰り返し出る課題、後悔)
```

## 各レイヤの責務

**raw/**
- 一次資料。LLM は追加はしてよいが、追加後は変更しない。
- nishio の要望・感想は、会話から**発言をそのまま**写して `raw/YYYY-MM-DD_<内容>.md` に置く。要約や解釈は wiki 側でやる。
- 実機での計測結果やスクリーンショットもここに置く(`raw/YYYY-MM-DD_<内容>.md`、画像は `raw/assets/`)。
- ファイル名は内容を表す名前にする。wiki から参照した後にリネームしない。

**wiki/**
- LLM がすべて書く。nishio は読んで指摘する。
- リンクは Obsidian 互換の相対パス `[表示名](../concepts/継ぎ紙モデル.md)`。コードへの参照は `../../src/xxx.ts` のような相対パス。
- ページ冒頭に YAML frontmatter:
  ```
  ---
  title: <ページタイトル>
  type: overview | requirements | concept | decision | finding | theme | meta
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  status: (decision のみ) adopted | superseded | proposed
  confidence: (finding のみ) 実機で確認 | 自動テストで確認 | 文書・仕様による | 未確認
  sources:
    - raw/...
  ---
  ```
- ページ末尾に「Sources」セクションを置き、根拠(raw/、コード、コミット、外部 URL)を列挙する。
- **確度を書き分ける。** 実機で確かめたこと、テストで確かめたこと、仕様や記憶に基づく推測を混ぜない。推測は推測と書く。iPad 実機での確認は nishio にしかできないので、未確認の主張は `confidence: 未確認` にして、確認されたら更新する。

## ワークフロー

### Develop(開発しながら記録する)
開発作業の中で次のどれかが起きたら、その作業の区切り(コミット前)で wiki に反映する:
- 設計の選択肢を比べて一つを選んだ → `decisions/` に 1 ページ。却下した案と理由も書く。後で覆したら `status: superseded` にして新しい判断ページへリンク。
- ブラウザ / OS / ライブラリの挙動で、知らなかった・予想と違ったことが分かった → `findings/`。
- 実装の中心になる考え方が固まった → `concepts/`。対応するコードへのリンクを付ける。
- 同じ種類の問題が 2 回以上出た、やり直しを後悔した → `themes/`。
- そのうえで `wiki/index.md` を更新し、`wiki/log.md` に `## [YYYY-MM-DD] develop | <主題>` で 3〜5 行を追記する。
- 「コードを読めば分かること」は wiki に書き写さない。書くのは**なぜそうしたか**と**やってみて分かったこと**。

### Ingest(一次資料の取り込み)
nishio のフィードバック(実機の感想、要望、不満)や外部資料が来たら:
1. `raw/` に保存(発言はそのまま)。
2. 要点を nishio に短く返す。
3. requirements / decisions / findings / concepts の関連ページを更新。矛盾する既存の記述は書き換え、古い主張を残さない。
4. `wiki/index.md` を更新、`wiki/log.md` に `## [YYYY-MM-DD] ingest | <ソース名>`。

### Query(問い合わせ)
1. `wiki/index.md` から関連ページを特定して読み、必要ならコードを一次参照する。
2. 回答に参照ページへのリンクを含める。
3. 価値ある合成は新規ページにすることを提案する。
4. `wiki/log.md` に `## [YYYY-MM-DD] query | <問い>`。

### Lint
依頼されたら、wiki とコードの食い違い、古い主張、孤立ページ、未確認のまま放置された finding を洗い出し、提案として返す。`## [YYYY-MM-DD] lint`。

## 開発ルール

- コマンド: `npm run dev`(開発サーバ)、`npm test`(Vitest)、`npm run build`(型検査 + ビルド)、`npm run e2e`(Playwright)。
- main へ push すると GitHub Actions が GitHub Pages(https://nishio.github.io/tsugigami/)へ公開する。
- **書いたものを失わないことが最優先。** 保存形式を変えるときは移行処理とテストを必ず付ける。IndexedDB のスキーマバージョンを上げずに形を変えない。
  - 守りの全体像は `wiki/concepts/書いたものを守る層.md`。保存の失敗を黙って捨てない(Store の列は成功するまで再試行する)。
  - GitHub の repo にあるファイルの形(`notes/<id>/note.json`、`p0001.json`)を変えるときも、古い形を読めるようにしておく(repo の履歴が戻し先になるため)。
  - 自動バックアップで、手元に無いノートのファイルを消す変更をしない。
- GitHub のトークンをコミット・ログ・wiki に書かない。本物の GitHub での確認は `GH_REAL_REPO=nishio/tsugigami-notes GH_REAL_TOKEN=$(gh auth token) npx playwright test github-real`(確認に使ったノートは最後に消す)。
- 起動時の案内画面、勧誘、使わない機能を入れない(Notability から離れる理由そのもの)。
- 描画のホットパス(pointermove → 描画)に、フレームワーク、DOM 更新、同期的な重い処理を挟まない。
- 実機でしか分からないこと(書き味、遅延、手のひら判定)は、自動テストで確かめたふりをしない。

## 関連

- Kozaneba の設計知識は別リポジトリ `~/kozaneba-dev-ai/`(Kozaneba の LLM Wiki)にある。tsugigami の知見のうち Kozaneba の設計に効くもの(1 次元と 2 次元の整理軸など)は `wiki/themes/` に書き、必要なら向こうの wiki にも反映を提案する。
