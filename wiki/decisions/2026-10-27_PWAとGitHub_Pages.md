---
title: PWA として GitHub Pages に置く
type: decision
status: adopted
created: 2026-10-27
updated: 2026-10-27
sources:
  - raw/2026-10-27_Notability置き換えの要件会話.md
---

# PWA として GitHub Pages に置く

## 決めたこと

- 公開リポジトリ `nishio/tsugigami` の main を GitHub Actions でビルドし、GitHub Pages(https://nishio.github.io/tsugigami/)に置く。
- iPad ではホーム画面に追加して、全画面のアプリとして使う。Service Worker でオフラインでも起動する。
- Service Worker はビルド時に成果物の一覧から生成する([vite.config.ts](../../vite.config.ts))。画面遷移は常にキャッシュから返すので起動が速い。新しい版は裏で取得され、**次の起動から**切り替わる。

## 比べた案

| 案 | 却下の理由 |
|---|---|
| claude.ai の Artifact | 最初の書き味テストはこれで出した。だが Service Worker が使えず、ダウンロードも止められるので、本体の置き場所にはならない([finding](../findings/Artifactでは試作しかできない.md)) |
| Firebase Hosting | Kozaneba で慣れているが、この作業環境では firebase CLI にログインしていない。ホスティング以外の機能を今は使わない |
| 非公開リポジトリ + Pages | 有料プランが要る。nishio が公開で OK と回答 |

## 気をつけること

- 更新が「次の起動から」なので、直した版を確かめるにはアプリを 2 回起動し直す必要がある。困るようなら、更新があったら控えめに知らせる方式に変える(起動時の案内を嫌って作っているので、出すとしても小さく)。

## Sources

- [raw/2026-10-27_Notability置き換えの要件会話.md](../../raw/2026-10-27_Notability置き換えの要件会話.md)
- [vite.config.ts](../../vite.config.ts), [.github/workflows/pages.yml](../../.github/workflows/pages.yml)
