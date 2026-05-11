import { env } from "../config/env.js";
import { PRIMARY_LLM_MODEL } from "../config/llm-model.js";
import type { RoleKey } from "../types.js";

interface GenerateParams {
  roleKey: RoleKey;
  query: string;
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

ユーザーロール: {{role_key}}
検索語: {{query}}
辞書ソース: {{dictionary_name}}
辞書定義: {{definition_json}}

出力形式:
【{{query}}】
意味:
わかりやすい説明:
ニュアンス:
`;

export async function generate(params: GenerateParams): Promise<string> {
  const prompt = PROMPT_TEMPLATE
    .replace("{{role_key}}", params.roleKey)
    .replace("{{query}}", params.query)
    .replace("{{dictionary_name}}", params.dictionaryName)
    .replace("{{definition_json}}", params.definitionJson);

  try {
    console.log(`[LLM] Gemini started → model=${PRIMARY_LLM_MODEL}`);
    return await callGemini(prompt);
  } catch (err) {
    console.warn(`[LLM] Gemini failed: ${err instanceof Error ? err.message : String(err)} → Check GEMINI_API_KEY or Gemma 4 model access, falling back to OpenRouter`);
    try {
      console.log(`[LLM] OpenRouter started → model=anthropic/claude-3.5-haiku`);
      return await callOpenRouter(prompt);
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
        model: "anthropic/claude-3.5-haiku",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
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
    console.log(`[LLM] OpenRouter success → model=anthropic/claude-3.5-haiku`);
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
