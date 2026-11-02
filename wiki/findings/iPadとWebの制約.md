---
title: iPad の Web アプリでできないこと・怪しいこと
type: finding
confidence: 未確認
created: 2026-10-27
updated: 2026-11-03
sources:
  - spike/pencil-ink-test.html
---

# iPad の Web アプリでできないこと・怪しいこと

実装前の知識と記憶に基づく一覧。確かめたら個別の finding に切り出し、確度を更新する。**2026-11-03 時点で、ホバー・合体/予測イベント・低遅延キャンバスの 3 行は lab の記録で確かめ、[実機の記録](iPadのSafariで届くイベントと機能.md) に切り出した。** それ以外の行は実機では確かめていない。

| 項目 | 予想 | 対応 |
|---|---|---|
| Pencil のダブルタップ・スクイーズ | Web からは取れない | 道具の切り替えはバーのボタンで |
| ペンのホバー | M2 以降の iPad + 対応 Pencil で pointermove(buttons=0)として届く | 届けば手のひら判定とカーソル表示に使う。「書き味の計測」に有無を表示。**実機(Safari 27.0.1)では届いていない**([実機の記録](iPadのSafariで届くイベントと機能.md)) |
| `getCoalescedEvents` / `getPredictedEvents` | Safari の対応状況は不確か | あれば使い、なければ無しで動く。計測欄に有無を表示。**実機では両方届く**(合体は毎回、予測は約半分の move。[実機の記録](iPadのSafariで届くイベントと機能.md)) |
| 低遅延キャンバス(`desynchronized`) | Safari は対応していない可能性が高い | 指定はしておく。計測欄に有無を表示。**予想は外れ: 実機では `desynchronized: true` が返る**(効き目は未計測。[実機の記録](iPadのSafariで届くイベントと機能.md)) |
| 画面の更新頻度 | ProMotion の iPad でも Safari の rAF は 60Hz に制限されることがある | 未計測 |
| 長押しのルーペ・選択メニュー | `touchstart` の preventDefault と `-webkit-touch-callout: none` で止まる | 実装済み、未確認 |
| ストレージの自動削除 | 7 日使わないサイトのデータを消すことがある。ホーム画面アプリは対象外とされる | `persist()` の申請とバックアップ |
| 共有シートでのファイル保存 | `navigator.share({ files })` がホーム画面アプリでも動く | 動かなければ `<a download>` に落ちる |
| キャンバスのメモリ上限 | iOS は合計のキャンバスメモリに上限がある | タイルキャッシュを 120MB に制限 |

## Sources

- [iPad の Safari で届くイベントと機能](iPadのSafariで届くイベントと機能.md)(確かめた 3 行の根拠)
- [spike/pencil-ink-test.html](../../spike/pencil-ink-test.html)(計測項目の元)
- 開発者の事前知識(未検証)
