# Phase 1 — main branch LLM 修正メモ

## 0. 目的

main ブランチでは、次の 2 点を分けて直す。

1. **有効化したカスタムプロンプトを bot に正しく渡す**
2. **Reasoning と回答本文を provider-native field で分離し、Reasoning は捨てて answer だけ使う**

このメモでは、固定システムプロンプトは使わない。別ブランチ側の検討として分離する。

> 注: 以前の `ANSWER:` / `【{{query}}】` ベースの橋渡しは暫定案だったが、現行 main では provider-native separation（Gemini の thought parts / OpenRouter の reasoning fields）へ切り替え済み。`{{query}}` は input variable のまま残す。

## 1. いま見えている事実

- `packages/bot/src/services/llm.service.ts` は provider-native separation を使い、legacy text markers を返さない。
- `packages/bot/src/events/messageCreate.ts` は active prompt 本文を読み、version と content hash を cache key に載せている。
- `packages/web/src/pages/api/admin/prompts.ts` と `packages/db/src/services/admin/prompt-admin.ts` には prompt の active 切替がある。
- 画面上で `Related Words:` や `Strictly based on dictionary?` が出るなら、default 側の文面が混ざっている可能性が高い。

## 2. 修正プラン 1 — カスタムプロンプトを正しく渡す

### 方針

- bot が **active prompt の本文**を取得する。
- `prompt.version` は **識別子**としてだけ使う。
- LLM に渡す prompt は、**有効化された本文そのもの**を使う。
- `llm.service.ts` は provider-native field を使って answer 本文だけを bot に返す。

### 期待結果

- Web 側で有効化した prompt が、次回の LLM 呼び出しから反映される。
- default prompt と custom prompt が混線しない。

## 3. 修正プラン 2 — Provider-native Reasoning / Answer separation

### 方針

- Gemini は `thinkingConfig.includeThoughts` を使い、`part.thought` で reasoning と answer を分ける。
- OpenRouter は `reasoning.exclude` を使い、`message.content` だけを answer として使う。
- bot は provider-native separation へ移行済み。`{{query}}` は input variable のまま。出力 marker の扱いは `DOCS/Prompts/prompt-v2.md` に集約する。
- 返答保存と Discord 送信には、プロバイダの answer 本文だけを使う。
- `extractFinalReply()` のようなテキストマーカー抽出は廃止済み。

### 期待結果

- Reasoning は API 側のフィールドに閉じ込められ、ユーザーや cache に漏れない。
- 回答本文は provider が返す answer field だけになる。

## 4. 受け入れ条件

- LLM に送る prompt の先頭で、active prompt 本文が確認できる。
- active prompt の本文が DB から取得され、その内容が LLM 送信 payload に入っている。
- Discord の最終出力が provider-native の answer 本文だけになる。
- 将来の provider-native 移行後は、テキストベースの output marker `ANSWER:` や `【{{query}}】` が混ざらない（`{{query}}` 変数自体は残る）。
- active prompt.version 変更で cache が分かれる。

## 5. 参照ファイル

- `packages/bot/src/services/llm.service.ts`
- `packages/bot/src/events/messageCreate.ts`
- `packages/web/src/pages/api/admin/prompts.ts`
- `packages/db/src/services/admin/prompt-admin.ts`

## 6. Implementation Log

- `messageCreate.ts` で `getActivePrompt()` を読み、active prompt の本文と version を cache key / LLM 送信に使うように切り替えた。
- `llm.service.ts` は bot から渡された prompt 本文を `replaceAll()` で展開するだけにして、固定テンプレート直書きをやめた。
- `PROMPT_VERSION` の見せ方を startup log から外し、DB の active row が prompt source であることを明示した。
- cache は `prompt.version` だけでなく `prompt.content` の hash も含めるので、同じ version を上書き保存しても最新内容が必ず再生成される。
- provider-native separation に切り替え、Gemini は `part.thought`、OpenRouter は `reasoning.max_tokens` 上限 + `reasoning.exclude=true` + `message.content` を使うようにした。
- これで reasoning 漏れがあっても、cache 保存と Discord 送信は answer 本文だけになる。
- provider-native へ切り替えたので、`extractFinalReply()` のような text-marker 依存は廃止した。

## 7. 2026-06-21 — `prompt_content_hash` を cache key から外した

### 何が変わったか

- `response_cache` の unique 制約を 7 要素から 6 要素に削減（`prompt_content_hash` を外した）。
- `response-cache.service.ts` の `WHERE` 句から `prompt_content_hash` 比較を削除。
- `prompt_content_hash` カラム自体は **DB に残す**（編集履歴・analytics メタ用）。

### なぜ変えたか

2026-06-12 〜 2026-06-21 の運用で観察:
- 同じ `prompt_version` でも prompt 本文を編集するたびに `prompt_content_hash` が変わる
- 過去 cache すべてが miss になり、再生成されていた（しみじみ・こっそり・雑用・地味など）
- 「version 一致 + hash 不一致で hit すべき」という運用改善要望

### 新しい挙動

| 操作 | 旧挙動 | 新挙動 |
|---|---|---|
| prompt 編集 → version 同じ | 過去 cache 全部 miss | hit する（旧答えが返る） |
| prompt 編集 → version bump | 過去 cache 全部 miss | 過去 cache 全部 miss（変化なし） |

### リスク

- version を bump し忘れると prompt 編集が反映されない。
- **緩和策**: Admin UI で prompt 編集時に version bump を強制する仕組みが必要（今後のタスク）。

設計詳細は `DOCS/Design/cache-key-prompt-version-only.md`。
