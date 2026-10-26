---
title: GitHub へのバックアップの実測(本物の API と長いノート)
type: finding
confidence: 自動テストで確認
created: 2026-10-27
updated: 2026-10-27
sources:
  - e2e/github-real.spec.ts
  - e2e/backup.spec.ts
---

# GitHub へのバックアップの実測(本物の API と長いノート)

## 本物の GitHub に対して(2026-10-27)

`e2e/github-real.spec.ts` を `GH_REAL_REPO=nishio/tsugigami-notes GH_REAL_TOKEN=$(gh auth token)` で流した。Chromium・WebKit とも通った。

- **ブラウザから直接呼べる。** api.github.com は CORS に対応していて、`Authorization: Bearer` 付きの要求が通る。
- **空の repo では git data API が 409 を返す。** そのため、まず contents API(`PUT /contents/README.md`)で最初の commit を作る。
  - 本物の repo では 409 だった。偽物では、ref が無いときの 404 も同じ扱いにしている。
- **書き込みの手順**
  - blob を 1 つずつ作る(4 並列)。
  - tree を `base_tree` + 変更分で作る。消すファイルは `sha: null`。
  - commit を作る。
  - ref を `force: false` で進める。先頭が進んでいて 422 が返ったら、最初からやり直す。
- 確かめに使ったノートは最後に消した。repo の先頭には README.md だけが残り、履歴に 5 commit 残っている。

## 長いノート(9,900 本、30 ページ)

ヘッドレスの WebKit・Chromium で、偽物の GitHub に対して測った。

- repo に置くファイルは 31 個(note.json + 30 ページ)、合わせて 8.6MB。点の座標は小数 2 桁に丸めている。
- 1 本書き足した後のバックアップで送るのは、note.json と書いたページの 2 つ(分が変わっていれば README も)。
  - Chromium: 181〜195ms
  - WebKit: 296ms
  - どちらも手元への保存の完了待ちを含む。
- 速くするためにしたこと
  - ページのファイルの中身と sha を、載っている線の id の並びで覚えておく。線は書いた後に変わらないので、書いていないページは作り直さない。
  - 開いているノートの線は、保存領域から読み直さず、画面上の Doc から取る。
- 最初の 1 回は全ページを作って送る。ヘッドレスでは数秒かかった(マシンが混んでいたので数字は粗い)。
- iPad 実機で、書き足した後のバックアップが書き味に響かないかは**未確認**。ペンが紙に触れている間は始めないようにしてある。

## Sources

- [e2e/github-real.spec.ts](../../e2e/github-real.spec.ts)、[e2e/backup.spec.ts](../../e2e/backup.spec.ts)、[src/github.ts](../../src/github.ts)
