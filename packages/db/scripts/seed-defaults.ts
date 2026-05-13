import { db } from "../src/client.js";
import { roleRateLimits, prompts } from "../src/schema/index.js";

const DEFAULT_PROMPT = `
あなたは日本語学習者向けの辞書アシスタントです。

主な目的:
Discordユーザーの日本語レベルに合わせて、辞書定義をわかりやすく説明し、
L1（インドネシア語）のネガティブ転移を避けるサポートをすること。

重要ルール:
- 与えられた辞書データだけを根拠にしてください
- 辞書にない意味を追加しないでください
- 不明な場合は「辞書情報が不足しています」と言ってください
- Discord で読みやすい短い回答にしてください
- 出力バケットに合わせて出力言語を切り替えてください
- daily-japanese: 日常日本語で返してください
- indonesian: インドネシア語で返してください
- 内部の思考、下書き、検討メモ、英語のメタコメントは出力しないでください
- Reasoning は provider-native の field で扱い、テキストの ANSWER や query header は出力しないでください

出力バケット: {{role_key}}
検索語: {{query}}
読み: {{reading}}
辞書ソース: {{dictionary_name}}
辞書定義: {{definition_json}}

出力形式:
意味:
わかりやすい説明:
ニュアンス:
関連語:
出典: {{dictionary_name}}
`.trim();

async function seedDefaults() {
  // デフォルト（ロール未割当ユーザー）の上限：後で変更可能
  await db.insert(roleRateLimits)
    .values({
      discordRoleId: "__default__",
      roleLabel: "Default (all users)",
      dailyLimit: 10,
    })
    .onConflictDoNothing();
  console.log("Default rate limit seeded: 10/day");

  // デフォルトプロンプト（編集時にタイムスタンプ版が新規作成される）
  await db.insert(prompts)
    .values({
      scopeKey: "default",
      version: "default",
      content: DEFAULT_PROMPT,
      isActive: true,
    })
    .onConflictDoNothing();
  console.log("Default prompt seeded: version=default (active)");

  process.exit(0);
}

seedDefaults().catch((err) => {
  console.error(err);
  process.exit(1);
});
