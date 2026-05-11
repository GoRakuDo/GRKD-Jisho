# Phase 1 — main branch LLM 修正メモ

## 0. 目的

main ブランチでは、次の 2 点を分けて直す。

1. **有効化したカスタムプロンプトを bot に正しく渡す**
2. **Reasoning と回答本文を必ず分離し、Reasoning は捨てて ANSWER だけ拾う**

このメモでは、固定システムプロンプトは使わない。別ブランチ側の検討として分離する。

## 1. いま見えている事実

- `packages/bot/src/services/llm.service.ts` は `PROMPT_TEMPLATE` をコード直書きしている。
- 修正前の `packages/bot/src/events/messageCreate.ts` は `env.PROMPT_VERSION` を cache key に載せているだけで、active prompt 本文は読んでいなかった。
- `packages/web/src/pages/api/admin/prompts.ts` と `packages/db/src/services/admin/prompt-admin.ts` には prompt の active 切替がある。
- 画面上で `Related Words:` や `Strictly based on dictionary?` が出るなら、default 側の文面が混ざっている可能性が高い。

## 2. 修正プラン 1 — カスタムプロンプトを正しく渡す

### 方針

- bot が **active prompt の本文**を取得する。
- `prompt.version` は **識別子**としてだけ使う。
- LLM に渡す prompt は、**有効化された本文そのもの**を使う。
- `llm.service.ts` の hardcode 依存を減らし、main ブランチで見ている文面と LLM に送る文面を一致させる。

### 期待結果

- Web 側で有効化した prompt が、次回の LLM 呼び出しから反映される。
- default prompt と custom prompt が混線しない。

## 3. 修正プラン 2 — Reasoning / ANSWER を2区画で分ける

### 方針

- LLM 出力に `REASONING:` と `ANSWER:` を明示させる案を残す。
- プロンプト本文にも `REASONING:` / `ANSWER:` の2区画を出すように書く案を残す。
- bot は将来的に **`ANSWER` だけ抽出**する。
- `REASONING` は cache 保存にも Discord 送信にも使わない方針を残す。
- `extractFinalReply()` は将来的に `ANSWER:` を起点に本文だけ返すように寄せる。

### 期待結果

- Reasoning 漏れがあっても、ユーザーには回答本文だけ届く。
- 保存される cache も回答本文だけになる。

## 4. 受け入れ条件

- LLM に送る prompt の先頭で、active prompt 本文が確認できる。
- active prompt の本文が DB から取得され、その内容が LLM 送信 payload に入っている。
- Discord の最終出力が `ANSWER` 本文だけになる。
- `Related Words:` などの default ラベルが混ざらない。
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
