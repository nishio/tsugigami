---
title: 線 1 本ずつ IndexedDB へ保存する
type: decision
status: adopted
created: 2026-10-27
updated: 2026-10-27
sources:
  - src/store.ts
  - src/doc.ts
---

# 線 1 本ずつ IndexedDB へ保存する

## 決めたこと

- IndexedDB に `notes`、`strokes`(`noteId` で索引)、`meta` の 3 つのストアを持つ。
- ストロークは 1 本を 1 レコードにする。点の列は `Float32Array`(x, y, 筆圧の 3 つ組)のまま保存する。
- 文書への変更はすべて操作(`add` / `del` / `swap` / `pages`)を通り、**適用と同時に差分だけ**書き込む。ペンを離した時点で保存が始まる。
- 取り消しも同じ操作の逆を適用するので、取り消した結果もそのまま保存される。

## 理由

- 書いたものを失わないのが最優先。ノート全体を後でまとめて保存する方式だと、アプリが落ちたときに直前の数分が消える。
- ノートが長くなっても、1 本書くたびの書き込み量は一定。
- 変形(移動・回転)は同じ id のレコードを置き換える(`swap`)。削除と追加に分けないので、途中で落ちても線が消えない。

## 却下した案

- localStorage: 容量が小さく(5MB 程度)、同期 API なので書くたびに描画が止まる。
- ノート 1 冊を 1 レコードにする: 実装は簡単だが、長いノートで 1 本ごとに全体を書き直すことになる。

## 気をつけること

- スキーマを変えるときは IndexedDB のバージョンを上げ、移行処理とテストを付ける(CLAUDE.md の開発ルール)。
- 保存に失敗したら、赤いトーストでバックアップの書き出しを促す。

## Sources

- [src/store.ts](../../src/store.ts), [src/doc.ts](../../src/doc.ts)
- [tests/store.test.ts](../../tests/store.test.ts), [tests/doc.test.ts](../../tests/doc.test.ts)
