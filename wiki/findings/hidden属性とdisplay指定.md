---
title: hidden 属性は display の指定に負ける
type: finding
confidence: 自動テストで確認
created: 2026-10-27
updated: 2026-10-27
sources:
  - src/style.css
---

# hidden 属性は display の指定に負ける

## 起きたこと

最初の e2e テストで 20 件中 15 件が「ボタンを押せない」で失敗した。ノート一覧(`#drawer`)と選択メニュー(`#selMenu`)は `hidden` 属性で隠したつもりだったが、CSS で `display: flex` を指定していたため、`hidden` が効かずに画面に出たまま、他のボタンを覆っていた。

## 理由

`hidden` 属性はブラウザの既定スタイル `[hidden] { display: none }` で隠しているだけなので、作者の CSS で `display` を指定するとそちらが勝つ。

## 対処

`[hidden] { display: none !important; }` を全体に入れた([style.css](../../src/style.css))。JS では `el.hidden = true/false` で表示を切り替えることに統一する。

## Sources

- [src/style.css](../../src/style.css)
- e2e テストの失敗(2026-10-27、WebKit / Chromium とも)
