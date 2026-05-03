# AGENTS.md — GRKD-Jisho 開発方針

このファイルは、このリポジトリで作業する人間・AIエージェント向けの開発ルールである。

目的はシンプル。
「辞書データを根拠に、Discord上で安全に学習者へ説明を返すBot」を作る。

---

## 1. プロダクトの方向性

GRKD-Jisho は、インドネシア語話者の日本語学習者向け Discord 辞書Botだ。

役割分担は固定する。

```txt
Yomitan辞書DB = 根拠となる情報源
LLM           = 辞書定義をロール別に言い換える係
Response-DB   = 生成済み・手動編集済み回答の保存場所
Admin UI      = 品質改善と管理の場所
```

LLMを「辞書そのもの」として扱わない。
LLMは、DBから取得した定義の説明係に限定する。

---

## 2. 技術スタック

採用スタックは以下で固定する。

| 領域 | 採用技術 |
|---|---|
| Bot | Node.js 20 LTS + TypeScript + discord.js v14 |
| DB | PostgreSQL 16 |
| ORM | Drizzle ORM |
| Package Manager | pnpm workspaces |
| LLM | Gemini primary / OpenRouter fallback |
| Web UI | Astro + React islands |
| Local infra | Docker Compose |

新しい技術を足す前に、既存スタックで解けない理由を書くこと。
「便利そう」だけで依存を増やさない。

---

## 3. リポジトリ構成

最終的な構成は monorepo とする。

```txt
packages/
  bot/   Discord Bot本体
  db/    Drizzle schema、DB client、import scripts
  web/   Admin Web UI
```

責務を混ぜない。

- `packages/db`: DB schema、DB client、migration、seed、importer
- `packages/bot`: Discord events、commands、Bot services
- `packages/web`: 管理画面のみ

Bot側で直接SQL文字列を散らさない。
DBアクセスは `@grkd/db` 経由に寄せる。

---

## 4. 実装順序

実装は ROADMAP のフェーズ順に進める。

```txt
Phase 0: monorepo / Docker / DB schema / Yomitan importer / env schema
Phase 1: Bot MVP / dictionary lookup / cache / LLM / rate limit / wipe scheduler
Phase 2: Slash command 管理機能
Phase 3: Web Admin UI
Phase 4: 品質改善・最適化
```

Phaseを飛ばさない。
特に DB schema と importer が固まる前に、Botの応答ロジックを作り込まない。

---

## 5. コード方針

### 5-1. KISS / YAGNI を優先

まず小さく作る。
MVPでは以下を守る。

- 辞書検索は「優先順位順に最初に見つかった1件」だけ使う
- 複数辞書の定義を混ぜない
- キャッシュキーは仕様通りに作る
- 管理画面より先に Bot MVP を完成させる

将来使うかもしれない抽象化は入れない。

### 5-2. サービス分割

Bot内の責務は小さな service に分ける。

```txt
dictionary.service.ts       辞書検索
role-mapper.service.ts      Discord Role -> role_key
response-cache.service.ts   生成済み回答の取得・保存
llm.service.ts              Gemini / OpenRouter 呼び出し
lookup-log.service.ts       検索ログ保存
rate-limit.service.ts       ユーザー別リミット
channel-wipe.service.ts     チャンネル消去
```

1ファイルに全部詰め込まない。

### 5-3. 型安全

- TypeScript `strict` を前提にする
- `any` に逃げない
- 外部入力は zod か明示的な型ガードで検証する
- Discord ID は `string` として扱う
- DBの `bigserial` は bigint/string 変換に注意する

---

## 6. DB方針

主要テーブルは以下。

```txt
dictionaries
dictionary_entries
response_cache
response_edits
lookup_logs
role_rate_limits
user_usage
channel_settings
```

### 6-1. キャッシュキー

回答キャッシュは単語だけで保存しない。

必ず以下の組み合わせで一意にする。

```txt
normalized_query
dictionary_id
dictionary_entry_id
role_key
prompt_version
model_name
```

ロール別・モデル別・プロンプト別に回答が変わるため。

### 6-2. 手動編集の優先

`response_cache.is_manual_override = true` は最優先。
LLMで上書きしてはいけない。

### 6-3. 編集履歴

回答を編集したら、必ず `response_edits` に履歴を残す。
誰が、いつ、何を、なぜ変えたかを追える状態にする。

---

## 7. LLM方針

LLMに自由回答させない。

プロンプトでは必ず以下を渡す。

- `role_key`
- `query`
- `dictionary_name`
- `definition_json`
- `prompt_version`

LLMの禁止事項。

- 辞書にない意味を追加しない
- 不明点を推測しない
- ユーザーのDiscordロール名をそのままプロンプトに入れない
- L1負の転移を煽る説明をしない

辞書情報が足りない場合は、足りないと返す。

---

## 8. Discord Bot方針

### 8-1. messageCreate

Botは許可チャンネルでのみ反応する。

基本フローは固定。

```txt
mention検知
-> query抽出
-> channel guard
-> rate limit check
-> dictionary lookup
-> role_key resolve
-> response cache check
-> LLM generate if miss
-> save cache / log
-> reply
```

### 8-2. Slash Command

管理コマンドは権限ガード必須。

管理者以外に、編集・削除・wipe・refreshを許可しない。

失敗時は基本的に ephemeral で返す。

---

## 9. Rate Limit方針

リセット基準は GMT+7 の日付。

```txt
毎日 00:00 GMT+7
```

Owner / Administrator は無制限。
一般ユーザーは DB の設定に従う。

優先順位は以下。

```txt
1. Guild Owner / Administrator -> 無制限
2. role_rate_limits に一致するロール -> 最も緩い daily_limit
3. __default__ レコード -> デフォルト上限
```

リミット判定をメモリだけで実装しない。
`user_usage` を使い、Bot再起動後も状態を保つ。

---

## 10. Channel Wipe-out方針

チャンネル自動消去は危険操作である。
実装・テスト・運用のすべてで慎重に扱う。

### 10-1. 対象

Wipe対象は `channel_settings.wipe_enabled = true` のチャンネルだけ。
それ以外のチャンネルを消してはいけない。

毎日 00:00 GMT+7 に動くため、通常の対象は直近24時間以内のメッセージ。
1日分のメッセージを全て消す。

固定メッセージは対象外。

### 10-2. 実装方式

完全性を優先する。

MASTER_PLAN の最新方針はチャンネルクローン方式。

```txt
pin取得
-> channel.clone()
-> old channel delete
-> pin再投稿 / 再pin
-> channel_settings.channel_id 更新
```

この方式なら14日制限に引っかからない。

### 10-3. 権限

Botには最低限以下が必要。

- `MANAGE_CHANNELS`
- `MANAGE_MESSAGES`
- `SEND_MESSAGES`

権限がない場合は処理を中断し、ログに残す。

---

## 11. やってはいけないこと

このプロジェクトでは以下を禁止する。

- LLMを辞書ソースとして扱う
- 辞書DBにない意味をLLMに補完させる
- MVP段階で複数辞書の定義を混ぜる
- キャッシュを `query` だけで作る
- `is_manual_override = true` の回答をLLMで上書きする
- Discordロール名を直接プロンプトに入れる
- Rate Limitをメモリだけで管理する
- wipe対象チャンネルをハードコードする
- `wipe_enabled = false` のチャンネルを消す
- 固定メッセージを消す
- `.env`、トークン、APIキー、Discord Bot Tokenをコミットする
- 本番DBや本番Discordサーバーで未検証のwipe処理を試す
- ユーザーに無断で大量削除・DB削除・チャンネル削除・git履歴改変を行う
- 既存ドキュメントと矛盾した実装を、確認なしに進める

---

## 12. テスト方針

最低限、以下を確認してから完了扱いにする。

### Phase 0

- `pnpm install`
- `docker compose up -d postgres`
- `pnpm db:generate`
- `pnpm db:migrate`
- `pnpm db:seed`
- Yomitan辞書のimport確認

### Phase 1

- Bot login
- 許可チャンネルだけ反応
- 辞書fallback
- cache hit / miss
- role_key別の返答
- rate limit超過
- wipe_enabled channel のみ wipe

### Phase 2以降

- 管理コマンドの権限ガード
- 編集履歴
- refresh後の再生成
- Web UIの認証ガード

---

## 13. ドキュメントの扱い

作業前に必ず読む。

```txt
MASTER_PLAN.md
ROADMAP.md
DOCS/Roadmap_Implement/phase-0-foundation.md
```

ただし、ドキュメント同士に矛盾がある場合は止まる。
勝手に片方を選ばない。

現時点の正は以下。

- Wipe-out はチャンネルクローン方式
- Phase 0 のDB完了基準は `channel_settings` を含む全8テーブル
- Wipe-out 対象は毎日 00:00 GMT+7 時点の直近24時間以内メッセージ
- 固定メッセージ（ピン留め）のみ保持する

実装前に、対象ドキュメントがこの方針と一致しているか確認すること。

---

## 14. 変更時の原則

大きく変えない。
必要な場所だけ変える。

作業の基本手順。

```txt
1. 関連ドキュメントを読む
2. 既存コードを読む
3. 影響範囲を確認する
4. 小さく変更する
5. 型チェック / テスト / 手動確認を行う
6. 結果と残リスクを記録する
```

コードがまだ存在しない場合でも、ドキュメントを根拠に最小構成から作る。

---

## 15. 判断に迷ったら

以下の順に判断する。

```txt
安全性 > データ保全 > ユーザー体験 > 実装速度 > 技術的きれいさ
```

Discordチャンネル削除、DB削除、履歴改変、外部API課金に関わる判断は必ず確認する。

「動くけど危ない」より、「少し遅いが壊さない」を選ぶ。
