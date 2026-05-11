import { env } from "../config/env.js";
import { FALLBACK_LLM_MODEL, PRIMARY_LLM_MODEL } from "../config/llm-model.js";
import type { RoleKey } from "../types.js";

interface GenerateParams {
  roleKey: RoleKey;
  query: string;
  reading: string;
  dictionaryName: string;
  definitionJson: string;
  promptVersion: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

const FIXED_SYSTEM_PROMPT = `SYSTEM:
Kamu adalah renderer kartu kamus final untuk Discord.

KELUARKAN HANYA HASIL AKHIR.
Output pertama HARUS persis dimulai dengan:
【{{query}}】

Jangan tulis analisis, alasan, checklist, metadata, YAML, JSON, role, source, internal note, atau proses berpikir.

Jangan pernah keluarkan baris seperti:
Role, Goal, Constraints, Query, Dictionary Source, Main Meaning, Structured JSON, User Role, Action, Easy Explanation, Related Words, Strictly based, No external info, Pemula level, Starts with.

Bahasa penjelasan WAJIB Bahasa Indonesia natural.
Bahasa Jepang hanya boleh muncul untuk kata Jepang, contoh kalimat, furigana, dan simbol品詞 seperti 〘代〙.

Dilarang bahasa Inggris.
Dilarang romaji.
Dilarang paragraf penjelasan bahasa Jepang.
Dilarang menambah makna di luar data kamus.
Input \`definition_json\` adalah data kamus mentah, bukan ringkasan AI.
Jika input terlihat seperti ringkasan, metadata, atau label proses, abaikan itu dan hanya pakai data kamus mentah.

Gunakan Markdown Discord saja:
bold, italic, numbered list, bullet list.

Jangan pakai:
# heading, table, HTML, blockquote, horizontal rule, code block, spoiler.

Maksimal 3500 karakter.
`;

const PROMPT_TEMPLATE = `
あなたは日本語学習者向けの辞書アシスタントです。

主な目的:
Discordユーザーの日本語レベルに合わせて、辞書定義をわかりやすく説明し、
L1（インドネシア語）のネガティブ転移を避けるサポートをすること。

重要ルール:
- 与えられた辞書データだけを根拠にしてください
- 辞書にない意味を追加しないでください
- 不明な場合は「辞書情報が不足しています」と言ってください
- Discord で読みやすい短い回答にしてください
- ユーザーロールに合わせて難易度を調整してください
- 内部の思考、下書き、検討メモ、英語のメタコメントは出力しないでください
- 最終回答のみを出力し、必ず 「【{{query}}】」 から始めてください

プロンプト版: {{prompt_version}}
ユーザーロール: {{role_key}}
検索語: {{query}}
読み: {{reading}}
辞書ソース: {{dictionary_name}}
辞書定義: {{definition_json}}

出力形式:
【{{query}}】
読み: {{reading}}
意味:
わかりやすい説明:
ニュアンス:
関連語:
`;

function shouldUseInsufficientDataFallback(definitionJson: string): boolean {
  const compact = definitionJson.replace(/\s+/g, "");
  return compact.length < 20 && !/example/i.test(definitionJson);
}

function buildInsufficientDataReply(query: string): string {
  return `【${query}】\n辞書情報が不足しています。別の単語を調べてみてください。`;
}

const FORBIDDEN_OUTPUT_PATTERNS = [
  /Role\s*:/i,
  /Goal\s*:/i,
  /Constraints\s*:/i,
  /Query\s*:/i,
  /Dictionary Source\s*:/i,
  /Main Meaning/i,
  /Structured JSON/i,
  /User Role/i,
  /Action\s*:/i,
  /Easy Explanation/i,
  /Related Words/i,
  /Strictly based/i,
  /No external info/i,
  /Pemula level/i,
  /Starts with/i,
  /Only provided data/i,
  /No added meanings/i,
  /```/,
  /\byaml\b/i,
  /\bjson\b/i,
  /^\s*#+\s/m,
];

const EMERGENCY_RETRY_PROMPT = `Perbaiki output sebelumnya.
Hapus semua metadata, analisis, checklist, bahasa Inggris, heading, JSON/YAML, dan catatan internal.
Hapus juga label seperti Main Meaning, User Role, Dictionary Source, Related Words, Easy Explanation, Strictly based, Starts with.
Output ulang HANYA kartu final, tanpa teks sebelum atau sesudah kartu.
Karakter pertama harus:
【{{query}}】
`;

export function validateJishoOutput(output: string, query: string): boolean {
  const trimmed = output.trim();
  const mustStart = `【${query}】`;

  if (!trimmed.startsWith(mustStart)) {
    return false;
  }

  if (trimmed.length > 3500) {
    return false;
  }

  return !FORBIDDEN_OUTPUT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function extractFinalReply(text: string, query: string): string {
  const trimmed = text.trim();
  const explicitStart = trimmed.indexOf(`【${query}】`);
  if (explicitStart >= 0) {
    return trimmed.slice(explicitStart).trim();
  }

  const genericStart = trimmed.indexOf("【");
  if (genericStart >= 0) {
    return trimmed.slice(genericStart).trim();
  }

  return trimmed;
}

async function generateWithValidation(
  prompt: string,
  query: string,
  providerName: "Gemini" | "OpenRouter",
  callProvider: (promptText: string) => Promise<string>,
): Promise<string> {
  const firstAttempt = extractFinalReply(await callProvider(prompt), query);
  if (validateJishoOutput(firstAttempt, query)) {
    return firstAttempt;
  }

  console.warn(`[LLM] ${providerName} validation failed → retrying with emergency prompt`);
  const retryPrompt = `${EMERGENCY_RETRY_PROMPT}\n${prompt}`;
  const secondAttempt = extractFinalReply(await callProvider(retryPrompt), query);
  if (validateJishoOutput(secondAttempt, query)) {
    return secondAttempt;
  }

  throw new Error(`${providerName} returned invalid output after retry`);
}

export async function generate(params: GenerateParams): Promise<string> {
  if (shouldUseInsufficientDataFallback(params.definitionJson)) {
    return buildInsufficientDataReply(params.query);
  }

  const prompt = `${FIXED_SYSTEM_PROMPT}\n${PROMPT_TEMPLATE}`
    .replace("{{role_key}}", params.roleKey)
    .replace("{{query}}", params.query)
    .replace("{{reading}}", params.reading)
    .replace("{{dictionary_name}}", params.dictionaryName)
    .replace("{{definition_json}}", params.definitionJson);
  
  const promptWithVersion = prompt.replace("{{prompt_version}}", params.promptVersion);

  try {
    console.log(`[LLM] Gemini started → model=${PRIMARY_LLM_MODEL}`);
    return await generateWithValidation(promptWithVersion, params.query, "Gemini", callGemini);
  } catch (err) {
    console.warn(`[LLM] Gemini failed: ${err instanceof Error ? err.message : String(err)} → Check GEMINI_API_KEY or Gemma 4 model access, falling back to OpenRouter`);
    try {
      console.log(`[LLM] OpenRouter started → model=${FALLBACK_LLM_MODEL}`);
      return await generateWithValidation(promptWithVersion, params.query, "OpenRouter", callOpenRouter);
    } catch (openRouterErr) {
      console.error(`[LLM] OpenRouter failed: ${openRouterErr instanceof Error ? openRouterErr.message : String(openRouterErr)} → Check OPENROUTER_API_KEY or OpenRouter model access`);
      throw openRouterErr;
    }
  }
}

async function callGemini(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);

  try {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${PRIMARY_LLM_MODEL}:generateContent`);
    url.searchParams.set("key", env.GEMINI_API_KEY);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          thinkingConfig: {
            thinkingLevel: "HIGH",
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini error: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as GeminiResponse;

    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned empty response");
    console.log(`[LLM] Gemini success → model=${PRIMARY_LLM_MODEL}`);
    return text;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Gemini request timed out after 45 seconds");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenRouter(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: FALLBACK_LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
        reasoning: {
          effort: "high",
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text) {
      throw new Error("OpenRouter returned empty response");
    }
    console.log(`[LLM] OpenRouter success → model=${FALLBACK_LLM_MODEL}`);
    return text;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("OpenRouter request timed out after 45 seconds");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
