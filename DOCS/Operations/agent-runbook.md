# GRKD-Jisho Agent Runbook

外側AIエージェントが MCP Control Plane 経由で GRKD-Jisho Bot を
監視・診断・安全操作するための手順書。

---

## 0. 前提条件

### 0-1. MCP 接続設定

```json
{
  "mcpServers": {
    "grkd-jisho": {
      "command": "node",
      "args": ["packages/mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "MCP_AGENT_ID": "my-agent",
        "MCP_READONLY_MODE": "true"
      }
    }
  }
}
```

### 0-2. アクセスレベル

| Level | 呼べるツール | 設定条件 |
|-------|-------------|----------|
| **L1 Read-only** | health / recent_errors / get_trace / lookup_stats / cache_stats / rate_limit_status / wipe_status（セクション1参照） | `MCP_READONLY_MODE=true`（デフォルト） |
| **L2 Dry-run** | L1 + `dry_run_*` 系 | `MCP_READONLY_MODE=false` + `MCP_ENABLE_DRY_RUN=true` |
| **L3 Limited write** | L1 + `request_*` 系（ops_jobs作成） | `MCP_READONLY_MODE=false` + `MCP_ENABLE_LIMITED_WRITE=true` |
| **L4 Dangerous** | `request_wipe_now` / `request_bulk_cache_delete` / `request_prompt_version_rotate` | Level 3 + 人間承認必須 |

MCP agent は接続時に自分のアクセスレベルを認識する必要がある。
Read-only で接続しているのに write request を呼ぼうとしてもエラーになる。

`MCP_AGENT_ID` に設定した値は、すべての Level 3+ 操作の `mcp_audit_logs` に記録される。
エージェントは自分の audit エントリを定期的に確認すること。

---

## 1. 通常監視フロー（L1 Read-only）

毎チェックサイクルでこの順番で実行する。

```txt
(1) grkd-jisho.health
      ↓ 異常なし → 終了
      ↓ heartbeat が古い → (2)
(2) grkd-jisho.recent_errors
      ↓ trace_id が特定できる → (3)
(3) grkd-jisho.get_trace
      ↓ 問題の分類と報告
      ↓
(4) grkd-jisho.lookup_stats       ← ルックアップ数が急減してないか
(5) grkd-jisho.cache_stats         ← キャッシュヒット率が異常値でないか
(6) grkd-jisho.rate_limit_status   ← 制限超過が多発してないか
(7) grkd-jisho.wipe_status         ← wipe 失敗レコードがないか
      ↓ wipe 失敗あり + L2以上 → grkd-jisho.dry_run_wipe
```

### 1-1. grkd-jisho.health

**目的:** Bot 全体が正常稼働中か確認する。

```txt
入力: なし
出力:
  - status: "ok" / "degraded" / "down"
  - heartbeat: 最新 heartbeat の created_at
  - last_wipe: 最後の wipe 実行時刻
  - db_connected: true / false

判断基準:
  - status = "ok" → 正常。次のサイクルまで待機
  - status = "degraded" → recent_errors を確認（セクション1-2参照）
  - status = "down" → 人間に通知（Bot再起動が必要）
  - heartbeat が5分以上前 → Botが応答していない可能性。recent_errors へ
```

### 1-2. grkd-jisho.recent_errors

**目的:** 直近のエラーイベントを取得する。

```txt
入力: なし（直近50件）
出力:
  - イベント一覧（level, message, trace_id, created_at）

判断基準:
  - level = "error" が複数ある → 障害発生中
  - trace_id が特定できるもの → get_trace で詳細調査
```

### 1-3. grkd-jisho.get_trace

**目的:** 特定の trace_id の全工程を追跡する。

```txt
入力: trace_id
出力:
  - 工程一覧（service, event, duration_ms, error）
  - 全体の応答時間

判断基準:
  - dictionary lookup が異常に遅い → DB 負荷 / index不足
  - LLM generate でエラー → API key / モデル問題
  - rate limit 超過 → user_usage のリセット検討
```

### 1-4. grkd-jisho.lookup_stats

**目的:** ルックアップ統計を確認する。

```txt
入力: なし（直近24時間）
出力:
  - lookups_today: 今日の検索数
  - top_queries: 人気クエリtop 10
  - avg_response_time: 平均応答時間

判断基準:
  - lookups_today が通常の半分以下 → Botが応答していない可能性
  - avg_response_time が5秒超 → LLMが遅延している
```

### 1-5. grkd-jisho.cache_stats

**目的:** キャッシュ状況を確認する。

```txt
入力: なし
出力:
  - total_entries: キャッシュ総数
  - manual_overrides: 手動編集数
  - hit_ratio: ヒット率（%）
  - stale_entries: 古いバージョンのエントリ数

判断基準:
  - hit_ratio が30%未満 → キャッシュが効いていない
  - stale_entries が多い → プロンプト更新後のリフレッシュを検討
```

### 1-6. grkd-jisho.rate_limit_status

**目的:** レートリミット設定と使用状況を確認する。

```txt
入力: なし（全設定表示）
出力:
  - role_rate_limits: ロール別制限値
  - top_consumers: 最も使っているユーザー top 10

判断基準:
  - 特定ユーザーが上限に頻繁に達している → 増枠を検討（MCP ツール `request_rate_limit_change` を使用）
  - __default__ が想定外の値 → 設定ミスの可能性
```

### 1-7. grkd-jisho.wipe_status

**目的:** Wipe 実行状況を確認する。

```txt
入力: なし
出力:
  - enabled_channels: wipe 有効チャンネル一覧
  - last_wipe: 最後の実行結果
  - failures: 直近の失敗

判断基準:
  - failure がある → dry_run_wipe で事後確認
  - enabled_channels が空 → 動作予定なし
```

---

## 2. Dry-run フロー（L2 Dry-run）

実際に変更を加えずに、操作結果をプレビューする。

### 2-1. grkd-jisho.dry_run_wipe

**目的:** Wipe がどの程度のメッセージに影響するか事前確認する。

```txt
入力: channel_id（省略可）
出力:
  - channel_id: 対象チャンネル
  - estimated_deletions: 削除予定メッセージ数
  - pinned_count: 固定メッセージ数（削除対象外）
  - is_enabled: wipe 有効か

判断基準:
  - estimated_deletions が想定より多い → 手動確認
  - is_enabled = false でも確認表示
```

### 2-2. grkd-jisho.dry_run_rate_limit_change

**目的:** レートリミット変更前に影響範囲を確認する。

```txt
入力: discord_role_id, new_limit
出力:
  - role_id: 対象ロール
  - current_limit: 現在の制限値
  - new_limit: 新しい制限値
  - affected_users_count: 影響を受けるユーザー数
```

### 2-3. grkd-jisho.dry_run_cache_refresh

**目的:** キャッシュクリア前に削除対象を確認する。

```txt
入力: dictionary_id（省略可）, prompt_version（省略可）
出力:
  - estimated_deletions: 削除予定件数
  - manual_overrides_protected: 保持される手動編集数
  - note: "手動編集は is_manual_override=true のため削除されません"
```

---

## 3. 操作依頼フロー（L3 Limited write）

実際の変更が必要な場合、`request_*` ツールで ops_jobs を作成する。
Bot または人間が確認・実行するまで待機する。

### 3-1. 基本的な流れ

```txt
(1) dry_run で影響を確認
(2) request_*_tool で ops_jobs を作成
(3) ops_jobs が pending 状態であることを確認
(4) Bot が自動実行（Bot の 30秒ポーリングで ops_jobs を処理。承認不要）
(5) ops_jobs の結果を grkd-jisho.get_trace で確認
(6) Level 3+ の操作は自動的に `mcp_audit_logs` に記録される。自分の audit エントリを確認すること
```

特に destructive な操作は必ず dry_run を先に実行すること。
dry_run なしでの request は運用ルール違反。

### 3-2. grkd-jisho.request_cache_refresh

```txt
目的: キャッシュを再生成する。
トリガー: cache_stats の stale_entries が急増した / プロンプトを更新した
入力:
  - dictionary_id: 辞書ID（省略可 / 全辞書）
  - prompt_version: プロンプトバージョン（省略可 / 全バージョン）
制限:
  - 1回のジョブで削除できる件数は CACHE_REFRESH_MAX_ROWS まで
  - is_manual_override=true のエントリは削除されない
```

### 3-3. grkd-jisho.request_user_usage_reset

```txt
目的: 特定ユーザーの使用回数をリセットする。
トリガー: rate_limit_status で上限到達が頻発するユーザーがいる
入力:
  - discord_user_id: 対象ユーザーID（必須）
注意:
  - リセットは即時反映される
```

### 3-4. grkd-jisho.request_rate_limit_change

```txt
目的: ロール別レートリミットを変更する。
トリガー: 運用上の理由で制限値を変更したい
入力:
  - discord_role_id: 対象ロールID（__default__ 可）
  - daily_limit: 新しい上限値
注意:
  - __default__ を変更すると全ユーザーに影響する
  - 変更前に dry_run_rate_limit_change で影響確認
```

### 3-5. Wipe setting changes (Web UI only)

```txt
目的: チャンネルのwipe有効/無効を切り替える（Web UI で実施）。
トリガー: wipe を開始/停止したい
入力:
  - channel_id: 対象チャンネルID
  - enabled: true（有効）/ false（無効）
注意:
  - wipe を有効にすると毎日 00:00 GMT+7 に自動実行される
  - 固定メッセージは削除されない
```

---

## 4. 危険操作フロー（L4 Dangerous）

必ず人間承認が必要。提出後、Web Admin UI でオペレーターが確認・承認するまで待機する。

### 4-1. grkd-jisho.request_wipe_now

```txt
目的: チャンネルを即時wipeする。
トリガー: 緊急時のクリーンアップ
入力:
  - channel_id: 対象チャンネルID（必須）
注意:
  - 人間承認必須
  - 承認後、Botが即座に bulkDelete を実行する
  - 固定メッセージは削除されない
```

### 4-2. grkd-jisho.request_bulk_cache_delete

```txt
目的: 大量のキャッシュを一括削除する。
トリガー: 障害復旧 / 大規模なプロンプト更新
入力:
  - dictionary_id（省略可）
  - prompt_version（省略可）
  - confirm: true（必須）
注意:
  - 人間承認必須
  - is_manual_override=true のエントリは削除されない
```

### 4-3. grkd-jisho.request_prompt_version_rotate

```txt
目的: 使用するプロンプトバージョンを切り替える。
トリガー: 新しいプロンプトバージョンへの移行
入力:
  - new_version: 切り替え先バージョン名（例: "v2"）
注意:
  - 人間承認必須
  - 切り替え後、旧バージョンのキャッシュは残る
  - cache_refresh で新しいプロンプトでの再生成が必要
```

---

## 5. 緊急停止判断

以下の条件のいずれかに該当する場合、作業を直ちに中断し人間に報告する。

### 5-1. 即時停止条件

```txt
- health が "down" を返した → Bot が応答していない
- recent_errors に未知のエラーが集中している
- 想定と異なるチャンネルが wipe 対象になっている
- 本番DB の DATABASE_URL が変更されている
- MCP の応答が通常と異なる（audit log に無い操作が記録されている）
```

### 5-2. 操作中断条件

```txt
- dry_run の結果が想定の2倍以上異なる
- request_* の ops_jobs 作成に失敗した
- 人間承認が24時間以上得られなかった
- 他の agent と競合している可能性がある
```

### 5-3. 報告テンプレート

```txt
【GRKD-Jisho Agent Report】
- 検出時刻: YYYY-MM-DD HH:mm:ss
- 状態: ok / degraded / down
- 発見項目:
  1. ...
  2. ...
- 提案アクション:
  - ...
- 保留事項:
  - ...
```

---

## 6. 禁止事項

- Discord Bot Token を MCP 設定に含めない。
- MCP から Discord API を直接呼び出さない。
- token / secret / API key をツール出力に含めない。
- 任意SQL の実行を要求しない。
- Level 4 の操作を人間承認なしに進めない。
- `request_wipe_now` / `request_bulk_cache_delete` / `request_prompt_version_rotate` は必ず人間承認を得てから実行する。
- `request_*` ツールを使う前に必ず `dry_run_*` で影響を確認する。

---

## 7. トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| health が "down" | DB接続断 / Botプロセス停止 | 人間に通知、Bot再起動 |
| heartbeat が5分以上古い | Bot が応答していない | recent_errors → get_trace |
| lookup_stats が0 | 設定ミス / チャンネル変更 | health 確認後、設定確認 |
| cache hit ratio が異常 | プロンプト更新直後 | cache_stats 確認 → refresh検討 |
| rate_limit 超過多発 | 設定ミス / DDoS | rate_limit_status → 増枠検討 |
| wipe 失敗 | Bot権限不足 / チャンネル削除 | wipe_status → dry_run_wipe |
| MCP 接続できない | DATABASE_URL 未設定 | 環境変数確認 |
| ツール実行時に認証エラー | audit log の agent_id 不一致 | MCP_AGENT_ID 確認 |
| ops_job が承認されない | 承認者不在 / 設定ミス | Web Admin UI で確認依頼 |
