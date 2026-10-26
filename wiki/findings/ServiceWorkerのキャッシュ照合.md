---
title: Service Worker のキャッシュが当たらない 2 つの罠
type: finding
confidence: 自動テストで確認
created: 2026-10-27
updated: 2026-10-27
sources:
  - vite.config.ts
  - e2e/robust.spec.ts
---

# Service Worker のキャッシュが当たらない 2 つの罠

「一度開いたらオフラインでも起動する」を e2e テスト(Chromium、`context.setOffline(true)` で再読み込み)で確かめたら、HTML だけ出て JS と CSS が読めず、アプリが起動しなかった。

## 1. `cache.addAll` に同じ URL が 2 回あると全体が失敗する

Vite のバンドル一覧には `index.html` も含まれるので、手で足した `index.html` と重複していた。`cache.addAll` は重複があると例外になり、何もキャッシュされない。→ 一覧を `Set` で重複除去した。

(この件は、後で 2 の調査中に「キャッシュには全部入っている」ことを確認しており、Chromium では重複でも通った可能性がある。仕様上は重複で失敗しうるので、除去は残す。)

## 2. `caches.match` は既定で `Vary` ヘッダを守る

`vite preview` は `Vary: Origin` を付けて返す。`cache.addAll` で入れた応答は Origin なしの要求に対するもので、モジュールの `<script type="module">` の要求には Origin が付くので、**URL が同じでも照合が外れる**。オフラインだとそのまま失敗する。→ `caches.match(req, { ignoreVary: true })` にした。

GitHub Pages が返す `Vary` は確認していない(`Accept-Encoding` だけなら問題は出ないはず)。どちらにしても `ignoreVary` で安全側に倒した。

## 教訓

Service Worker は「動いているように見えて、オフラインでだけ壊れている」ことがある。オフライン起動は e2e テストに常設した([e2e/robust.spec.ts](../../e2e/robust.spec.ts))。

## Sources

- [vite.config.ts](../../vite.config.ts)(Service Worker の生成)
- [e2e/robust.spec.ts](../../e2e/robust.spec.ts)
