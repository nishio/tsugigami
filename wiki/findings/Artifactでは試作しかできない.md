---
title: claude.ai の Artifact では試作しかできない
type: finding
confidence: 文書・仕様による
created: 2026-10-27
updated: 2026-10-27
sources:
  - spike/pencil-ink-test.html
---

# claude.ai の Artifact では試作しかできない

最初の書き味テスト([spike/pencil-ink-test.html](../../spike/pencil-ink-test.html))は claude.ai の Artifact として公開した(https://claude.ai/artifact/F5HTwJXLp4vjNdPznfi21R)。URL を iPad で開くだけで試せるので、試作には便利。

ただし、Artifact の実行環境の説明によると:

- Service Worker が使えない → オフライン起動やホーム画面アプリにできない。
- ページからのダウンロードが止められる → バックアップの書き出しができない。
- claude.ai の画面の中に表示されるので、本番より周りの枠が多く、書き味の比較もやや割り引いて見る必要がある。

そのため本体は GitHub Pages に置いた([判断](../decisions/2026-10-27_PWAとGitHub_Pages.md))。書き味テストは実機確認用として残している。

## Sources

- [spike/pencil-ink-test.html](../../spike/pencil-ink-test.html)
- Claude Code の Artifact ツールの説明(2026-10-27 時点)
