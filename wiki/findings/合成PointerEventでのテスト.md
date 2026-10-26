---
title: 合成した PointerEvent でペン入力をテストする
type: finding
confidence: 自動テストで確認
created: 2026-10-27
updated: 2026-10-27
sources:
  - e2e/app.spec.ts
---

# 合成した PointerEvent でペン入力をテストする

Playwright のマウス・タッチ操作では `pointerType: 'pen'` を出せないので、`new PointerEvent('pointerdown', { pointerType: 'pen', pressure, ... })` をステージに直接 `dispatchEvent` して書く操作を再現している([e2e/app.spec.ts](../../e2e/app.spec.ts))。

分かったこと:

- WebKit(Playwright 同梱の WebKit 27.2)と Chromium の両方で、合成した pen / touch の PointerEvent がアプリの処理に届く。描く・消す・投げ縄・変形・手のひら判定・指スクロールが自動テストで回る。
- 合成イベントでは `getCoalescedEvents()` が空を返す前提でコードを書いた(空なら元のイベントだけを使う)。`setPointerCapture` は実在しないポインタ id で例外になりうるので try で包んだ。
- **これで確かめられるのはロジックだけ。** 書き味、遅延、本物の Pencil の筆圧・ホバー、手のひらの実際の触れ方は分からない([実機でしか分からないこと](../themes/実機でしか分からないこと.md))。
- iPad 相当の画面(834 × 1194、画素比 2)で撮ったスクリーンショットで、紙・方眼・マーカーがインクの下に来ること・選択枠とメニューを目視で確認した。

## Sources

- [e2e/app.spec.ts](../../e2e/app.spec.ts), [playwright.config.ts](../../playwright.config.ts)
