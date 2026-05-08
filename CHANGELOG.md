# Changelog

## [Unreleased] — 2026-05-07

### Added

- **C-1: `pnpm db:setup` CLI** — PostgreSQL のユーザー作成・DB作成・migration を一発実行。DRY_RUN 対応、SQL インジェクション対策済み（escapeIdent/escapeLiteral）。
- **C-2: `pnpm deploy:pg-config` CLI** — RAM 自動検出 → `ALTER SYSTEM SET` で PostgreSQL 設定値をチューニング。ホワイトリスト方式で安全。
- **C-3: `pnpm deploy:check` CLI** — デプロイ前に 7 項目（Node/PG/空き容量/env/フォーマット）を一括チェック。`--json` 対応。
- **C-4: `pnpm env:validate` CLI** — 全パッケージ横断で環境変数の充足状況を zod 検証。共有スキーマを `packages/db/src/env-schema.ts` に集約。
- **C-5: 既存スクリプト強化** — `deploy-precheck.sh/ps1` が `pnpm deploy:check` を呼ぶ純粋ラッパーに。
- **`DOCS/Operations/deploy-improvements.md`** — デプロイ改善プラン文書。

### Changed

- **Scripts**: `deploy-precheck.sh` と `deploy-precheck.ps1` の内部ロジックを `pnpm deploy:check` 呼び出しに統一。

### Security

- すべての動的 SQL に `escapeIdent()` / `escapeLiteral()` を適用（SQL インジェクション対策）。
- `ALTER SYSTEM SET` に `assertAllowedParam()` ホワイトリストを導入。

## [v0.1.0] — 2026-05-07

### Added

- 初回 Pre-Release。
- Phase 0-4 全実装完了（Bot MVP / Admin コマンド / MCP Control Plane / Web Admin UI / 品質最適化）。
- Pre-Release 基準 R-1〜R-5 検証完了。
- GitHub Pre-Release 公開（`https://github.com/GoRakuDo/GRKD-Jisho/releases/tag/v0.1.0`）。
- Docker イメージ（bot / web）ビルド確認済み。
- 全 39 ユニットテスト通過。
- 静的型チェック 4 パッケージ（db / bot / mcp / web）通過。
- 禁止パターンスキャン（as any / eslint-disable / Asia/Bangkok / @grkd- / 純黒白）0 件。

### Notes

- NPM publish はスキップ（全パッケージ `private: true`）。
- MCP Level 4 dangerous tools は Phase 5 TBA に先送り。
- マルチギルド対応は Phase 5 TBA に先送り。
- 手動検証（生 Discord サーバー）は未完了。ステータスは NOT READY。

---

形式: [Keep a Changelog](https://keepachangelog.com/)。
