# Cache Key — Remove `prompt_content_hash` from Lookup

> **Status:** Implementing (2026-06-21)
> **Phase:** Phase 4 quality optimization follow-up
> **Author:** Kuraudo + user
> **Related:** `AGENTS.md` §6-1, `MASTER_PLAN.md` §5-3, `phase-1-llm-repair-main-branch.md`

---

## 問題 (Background)

現在 `response_cache` の cache key は 7 要素:

```txt
normalized_query
dictionary_id
dictionary_entry_id
role_key
prompt_version
prompt_content_hash
model_name
```

2026-06-12 〜 2026-06-21 の運用で観察されたケース:

| 日付 | prompt_version | prompt_content_hash | 結果 |
|---|---|---|---|
| 6/12 21:36 | 2026-06-10_121331147 | `e7102633` | 初回生成 → cacheId=292 |
| 6/13 07:15 | 2026-06-10_121331147 | `76f7a712` | prompt 編集 → 再生成 |
| 6/21 21:25 | 2026-06-10_121331147 | `845fde28` | prompt 編集 → 再生成 |

`prompt_version` は 9 日間ずっと同じなのに、prompt 本文を 2 回編集しただけで
過去 cache が全部無効化され、再生成された。
ユーザーから「hash 違いでも version 一致なら hit にして」という改善要望。

---

## 採用方針 (Decision)

`prompt_content_hash` を **cache key から外す**。
代わりに、prompt 編集時は **必ず version を bump する運用ルール** で同等以上の安全性を担保する。

### 新しい cache key (6 要素)

```txt
normalized_query
dictionary_id
dictionary_entry_id
role_key
prompt_version
model_name
```

### hash フィールドの扱い

`prompt_content_hash` カラム自体は **DB に残す**。
用途: 編集履歴 (`response_edits`) とキャッシュの関連付け、analytics でのメタ情報。
cache key の `WHERE` 句には使わない。

---

## なぜ安全か (Rationale)

### prompt 編集の影響範囲

| 操作 | 旧挙動 (hash in key) | 新挙動 (hash out of key) |
|---|---|---|
| prompt 編集 → version 同じ | cache 全部 miss → 全部再生成 | cache hit する (旧答えが返る) |
| prompt 編集 → version bump | cache 全部 miss → 全部再生成 | cache 全部 miss → 全部再生成 (変化点) |

新挙動のリスク: version を bump し忘れると、prompt 編集が反映されない。
→ これを **Admin UI で version bump を強制** + **運用ガイドで明示** で緩和する。

### 過去の経緯

`prompt_content_hash` を cache key に入れた理由は `phase-1-llm-repair-main-branch.md:17,67,70` に記録されている:

> cache は `prompt.version` だけでなく `prompt.content` の hash も含めるので、
> 同じ version を上書き保存しても最新内容が必ず再生成される。

これは「version bump を強制しなかった頃の安全網」だった。
Admin UI に「prompt 編集 = version bump 強制」の仕組みを入れる前提なら、hash は不要になる。

---

## 実装 (Implementation)

### 1. スキーマ変更

`packages/db/src/schema/response-cache.ts`:

```ts
unique("uq_response_cache_key").on(
  table.normalizedQuery,
  table.dictionaryId,
  table.dictionaryEntryId,
  table.roleKey,
  table.promptVersion,
  // table.promptContentHash,  ← 削除
  table.modelName
)
```

### 2. migration

`pnpm db:generate` で 0019 系を生成。
手動 SQL で:
- `DROP CONSTRAINT uq_response_cache_key`
- `ADD CONSTRAINT uq_response_cache_key UNIQUE (normalized_query, dictionary_id, dictionary_entry_id, role_key, prompt_version, model_name)`

### 3. コード変更

`packages/bot/src/services/response-cache.service.ts`:

```ts
// eq(schema.responseCache.promptContentHash, key.promptContentHash),
// ↑ を削除
```

`packages/bot/src/types.ts` の `CacheKey` 型から `promptContentHash` を消すか
or 残して saveResponse の保存値として使うか → 残す方向（DB には保存する）

### 4. テスト更新

`packages/bot/src/services/__tests__/response-cache.test.ts`:
- 既存テスト 4 件の `promptContentHash` フィールドはそのまま
- 新規テスト追加: 「hash 違いでも version 一致なら hit する」

### 5. ドキュメント更新

- `AGENTS.md` §6-1: cache key 仕様から `prompt_content_hash` を削除
- `MASTER_PLAN.md` §5-3: 該当箇所
- `phase-1-llm-repair-main-branch.md`: この設計変更の記録を追記
- `dictionary-example-normalization.md` §A: 古い説明を更新

---

## 影響範囲 (Blast Radius)

| ファイル | 変更 |
|---|---|
| `packages/db/src/schema/response-cache.ts` | unique 制約から promptContentHash 削除 |
| `packages/db/drizzle/XXXX_*.sql` | 新規 migration |
| `packages/bot/src/services/response-cache.service.ts` | `WHERE` から promptContentHash 削除 |
| `packages/bot/src/services/__tests__/response-cache.test.ts` | 新テスト追加 |
| `AGENTS.md` | §6-1 仕様更新 |
| `MASTER_PLAN.md` | §5-3 更新 |
| `DOCS/Roadmap_Implement/phase-1-llm-repair-main-branch.md` | 記録追記 |
| `DOCS/Design/dictionary-example-normalization.md` | §A 更新 |

---

## ロールバック (Rollback)

1. migration の逆: `ALTER TABLE response_cache ADD CONSTRAINT ... UNIQUE (..., prompt_content_hash, ...)`
2. コードの `WHERE` 句復活
3. ただし 1 つの record が「同じ 6 要素 key で複数存在」する状態になると、
   unique 制約が復元できない可能性あり。
   → ロールバック前に重複掃除が必要。

---

## 完了条件 (Completion Criteria)

- [ ] migration がローカル + Kasou で適用成功
- [ ] bot tsc / テスト全 pass
- [ ] db tsc pass
- [ ] しみじみのような過去重複 cache は再生成不要 (version 一致 + hash 違いで hit)
- [ ] ドキュメント 4 ファイル更新
- [ ] code-reviewer APPROVE
- [ ] Kasou deploy 完了
