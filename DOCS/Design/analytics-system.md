# Analytics System

## 目的

Bot の使用状況を時系列で可視化する Analytics ページを専用 SQLite に集約し、既存の PostgreSQL（辞書・キャッシュデータ）と物理分離する。

## なぜ SQLite か

| 要件 | JSON ファイル | SQLite |
|------|---------------|--------|
| 追記 | ファイル全体読込→書戻し | `INSERT` 1行 |
| 破損リスク | 書込中停電→全滅 | atomic rename → 直前 export まで保証 |
| 並行アクセス | cron 書込中に WebUI 読込→壊れる | atomic rename → partial read 防止 |
| 10年運用 | 700KB JSON → 読書が重い | 700K行でも余裕 |
| インフラ増加 | ゼロ（ファイル1つ） | ゼロ（ファイル1つ） |

## データモデル

### SQLite テーブル: `hourly_stats`

```sql
CREATE TABLE hourly_stats (
  hour            TEXT NOT NULL,   -- ISO 8601: "2026-05-15T14:00:00Z"
  bucket_key      TEXT NOT NULL,   -- 'daily-japanese' | 'indonesian'
  total_lookups   INTEGER NOT NULL DEFAULT 0,
  cache_hits      INTEGER NOT NULL DEFAULT 0,
  cache_misses    INTEGER NOT NULL DEFAULT 0,
  llm_gemini      INTEGER NOT NULL DEFAULT 0,  -- Gemini 応答数
  llm_openrouter  INTEGER NOT NULL DEFAULT 0,  -- OpenRouter 応答数
  PRIMARY KEY (hour, bucket_key)
);
```

### データ量の試算

```
1時間 = 2バケツ × 1行 = 2行
1日   = 48行
1年   = 17,520行
10年  = 175,200行
```

SQLite で全く問題ない規模。

## 集計方法

### 1. lookup_logs にカラム追加

Analytics のために lookup_logs に2カラム追加:

| カラム | 型 | 必須 | 説明 |
|--------|------|------|------|
| `output_bucket_key` | `text` | YES | ルーティング先バケット |
| `llm_source` | `text` | NO | LLM 呼出時のみ: `'gemini'` / `'openrouter'` |

これらは「分析データ」ではなく「ルックアップの記録項目」であり、ログの充実に過ぎない。
集計はこの2カラムを GROUP BY して SQLite に書き込む。

### 2. 集計 cron（3時間おき、00:00 / 03:00 / 06:00 / ...）

cron 式: `0 */3 * * *`（Asia/Jakarta）

```
messageCreate.ts で設定された output_bucket_key と llm_source が
lookup_logs に記録される

↓ 3時間おきの00分に cron が発火

SELECT
  date_trunc('hour', created_at) AS hour,
  output_bucket_key,
  COUNT(*) AS total_lookups,
  SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END) AS cache_hits,
  SUM(CASE WHEN cache_hit = false AND response_cache_id IS NOT NULL THEN 1 ELSE 0 END) AS cache_misses,
  SUM(CASE WHEN llm_source = 'gemini' THEN 1 ELSE 0 END) AS llm_gemini,
  SUM(CASE WHEN llm_source = 'openrouter' THEN 1 ELSE 0 END) AS llm_openrouter
FROM lookup_logs
WHERE created_at >= date_trunc('hour', NOW()) - INTERVAL '3 hours'
  AND created_at < date_trunc('hour', NOW());

↓
INSERT OR REPLACE INTO hourly_stats (hour, bucket_key, ...)
VALUES (...)
```

前の時間のデータを集計して SQLite に書き込む（完了ベース）。

### 3. SQLite ファイル

- パス: `analytics/stats.db`（repo root。bot / web の両方が `process.cwd()` 基準で参照）
- 実装は `sql.js` を使用
- 永続化は WAL ではなく「メモリ DB を読み込み → 集計 → `export()` で書き戻し」方式
- cron は bot プロセス内の `node-cron` で実行

### 4. タイムフレームのクエリ

WebUI からは原則 SQLite を読む。SQLite が空 / 未生成なら PostgreSQL `lookup_logs` を直接集計して fallback する:

```sql
-- 1日の例
SELECT * FROM hourly_stats
WHERE hour >= datetime('now', '-1 day', 'start of day')
  AND hour < datetime('now', 'start of day', '+1 day')
ORDER BY hour, bucket_key;
```

各タイムフレームの WHERE 条件:

| フレーム | SQLite offset |
|----------|---------------|
| 1日 | `-1 day` |
| 3日 | `-3 days` |
| 7日 | `-7 days` |
| 2週間 | `-14 days` |
| 3週間 | `-21 days` |
| 1ヶ月 | `-1 month` |
| 3ヶ月 | `-3 months` |

## API 設計

### GET /api/admin/analytics?period=7d

Response:
```json
{
  "period": "7d",
  "buckets": {
    "daily-japanese": {
      "totalLookups": 1240,
      "cacheHitRate": 0.72,
      "llmUsage": { "gemini": 300, "openrouter": 47 },
      "hourly": [
        { "hour": "2026-05-15T14:00:00Z", "lookups": 20, "cacheHits": 15, "llmGemini": 4, "llmOpenrouter": 1 },
        ...
      ]
    },
    "indonesian": { ... }
  },
  "popularQueries": [
    { "query": "可憐", "count": 42 },
    ...
  ],
  "dictionaryHits": [
    { "dictionaryName": "JMdict", "hitCount": 850 },
    ...
  ]
}
```

`popularQueries` と `dictionaryHits` は現在 Dashboard にあるものを Analytics ページへ移動。
Dashboard からは削除する。

## チャート表示

### ライブラリ: uPlot

- 50 KB、依存ゼロ
- 時系列グラフに特化
- Canvas 2D → OKLCH 色を直接渡せる
- Tesla/SpaceX ミニマリストと親和性高い

### 表示するグラフ

1. **Request Rate（リクエスト数/時間）**
   - 折れ線グラフ、Lookups と Cache Misses の 2 系列
   - X軸: 時間、Y軸: リクエスト数

2. **Cache Hit Rate（キャッシュ当たり率）**
   - 折れ線グラフ、全バケツ合算の 1 系列
   - X軸: 時間、Y軸: %

3. **Model Usage（LLM呼出回数）**
   - サマリーカードで表示（Gemini / OpenRouter 合計と内訳）
   - 時系列グラフを追加するなら別 Step に分離する

### ページレイアウト

```
┌─────────────────────────────────────────────────┐
│  [1d] [3d] [7d] [2w] [3w] [1m] [3m]            │  ← タイムフレーム選択
├─────────────────────────────────────────────────┤
│  MetricCard: Lookups (7d)  │ Cache Hit Rate │ ...  │  ← サマリー
├─────────────────────────────────────────────────┤
│  ┌─── Request Rate ─────────────────────────┐   │
│  │  📈 uPlot 折れ線グラフ                   │   │
│  │  (daily-japanese / indonesian 2系列)      │   │
│  └──────────────────────────────────────────┘   │
├─────────────────────────────────────────────────┤
│  ┌─── Cache Hit Rate ───────────────────────┐   │
│  │  📈 uPlot 折れ線グラフ                   │   │
│  └──────────────────────────────────────────┘   │
├──────────────────┬──────────────────────────────┤
│  Popular Queries │  Dictionary Hits             │
│  (TOP 20)        │  (バー or ランキング)        │
└──────────────────┴──────────────────────────────┘
```

## 実装状況

| Step | 状態 | Note |
|------|------|------|
| Step 1: lookup_logs にカラム追加 | ✅ Done | `output_bucket_key` + `llm_source` |
| Step 2: Analytics サービス作成 | ✅ Done | `packages/bot/src/services/analytics.service.ts`（sql.js） |
| Step 3: Cron 登録 | ✅ Done | `0 */3 * * *` Asia/Jakarta（index.ts） |
| Step 4: API エンドポイント | ✅ Done | SQLite 優先 + PostgreSQL fallback |
| Step 5: WebUI Analytics ページ | ✅ Done | uPlot グラフ + period 選択 + テーブル |
| Step 6: Dashboard からのコンポーネント削除 | ✅ Done | PopularQueries / DictionaryHits を Analytics に移動 |

## 実装手順

### Step 1: lookup_logs にカラム追加

- `output_bucket_key text NOT NULL DEFAULT ''`
- `llm_source text`
- messageCreate.ts の `finalizeLookup()` で両方を書き込む

### Step 2: Analytics サービス作成

- `packages/bot/src/services/analytics.service.ts`
  - `initAnalyticsDb()` - SQLite 初期化（DDL、WAL）
  - `aggregateHourly()` - PostgreSQL 集計→SQLite 書込
  - `queryAnalytics(period: string)` - SQLite 読込

### Step 3: Cron 登録

- bot の index.ts に 3時間おきの cron 追加（`0 */3 * * *` Asia/Jakarta）

### Step 4: API エンドポイント

- `packages/web/src/pages/api/admin/analytics.ts`
- CSRF + admin guard + session 認証
  - SQLite ファイル読み取り（`analytics/stats.db`）

### Step 5: WebUI Analytics ページ

- `packages/web/src/pages/admin/analytics.astro`
- uPlot を使ったグラフ表示
- Popular Queries / Dictionary Hits コンポーネントを Dashboard から移動
- Sidebar に Analytics リンク追加
- サマリーの Cache Hit Rate は `cacheHits / totalLookups` で 0〜100% に収める

### Step 6: Dashboard から旧コンポーネント削除

- `packages/web/src/pages/admin/dashboard.astro` から PopularQueriesTable / DictionaryHitsUI / LogsSummary を削除
- Dashboard は Bot 状態のサマリーに純化

## 依存追加

| パッケージ | 依存 |
|------------|------|
| `packages/bot` | `sql.js` |
| `packages/web` | `sql.js`, `uplot` |
| `@grkd-jisho/db` | 変更なし |

`sql.js` は Pure JS の SQLite 実装。ネイティブビルド不要。

## レガシーな考慮点

- Kasou の `lookup_logs` に既存データがあるが、`output_bucket_key` のデフォルト値は空文字
- 過去データは `unknown` バケットとして集計される。不要なら手動バックフィルする
- 新規データから徐々に蓄積される
- 手動バックフィルしたい場合は以下を Kasou で実行:
  ```sql
  UPDATE lookup_logs SET output_bucket_key = 'indonesian' WHERE output_bucket_key = '';
  ```
