---
title: iPad の Safari では IndexedDB との接続が切れることがある
type: finding
confidence: 文書・仕様による
created: 2026-10-27
updated: 2026-10-27
sources:
  - src/store.ts
---

# iPad の Safari では IndexedDB との接続が切れることがある

## 内容

iOS の Safari(ホーム画面アプリも含む)では、アプリが裏に回ってしばらくすると、IndexedDB との接続が切れることがある。そのあとの読み書きは全部、次のエラーで失敗する。

```
UnknownError: Connection to Indexed Database server lost. Refresh the page to try again
```

WebKit の不具合として広く報告されている(iOS 12.2 頃から)。ページを読み直すか、データベースを開き直せば直る。tsugigami の利用者の iPad で起きたかどうかは**未確認**。

## なぜ危ないか

前の版は、書き込みに失敗するとトースト(数秒で消える通知)を出すだけで、その線を捨てていた。
- 裏から戻って書き続けると、画面には線が見えている。でも保存されていない。
- アプリを閉じた時点で、その線は消える。
- 「消えないと信じられる」([raw](../../raw/2026-10-27_消えないと信じられること.md))を真っ向から壊す。

## 対策(`src/store.ts`)

- 書き込みはすべて 1 本の列に並べ、順に実行する。
- 失敗したら、データベースを開き直してやり直す(100ms, 0.5s, 2s, 5s, 以後 5s ごと)。諦めない。
  - 待っている線はメモリに残る。開いているノートの線は画面の Doc にもある。
- 失敗している間は、消えない赤い帯で「保存に失敗しています(n 件待ち)」と出し、メニューにも赤い点を付ける。成功したら「保存できました」。
- `db.onclose`(異常な切断)と `onversionchange` でも、次の操作の前に開き直す。
- 読み出しは 1 回だけ開き直して再試行する。
- ノートは列に並べた時点の内容を写して保存する(後で書き換わっても、並べた順の内容が残る)。
- ファイルへの書き出しは、開いているノートを画面上の内容で上書きしてから出す(保存待ちの線も漏らさない)。
- 書き込みのトランザクションに `durability: 'strict'` を付けた。Chrome の既定は relaxed なのでディスクに届く前に完了扱いになる。Safari はこの指定を無視する。

## 確かめ方

- 単体テスト(fake-indexeddb)と e2e(WebKit・Chromium)で確かめた。下の接続を `db.close()` で閉じてから書き、開き直して保存されること、再読み込み後も残ることを見ている。
- 本物の「接続が切れた」状態は、ヘッドレスでは作れない。閉じた接続への書き込みは `InvalidStateError` になり、同じ経路で開き直す。

## Sources

- [src/store.ts](../../src/store.ts)、[tests/store.test.ts](../../tests/store.test.ts)、[e2e/backup.spec.ts](../../e2e/backup.spec.ts)
