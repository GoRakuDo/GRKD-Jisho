import { env } from "../config/env.js";
import { FALLBACK_LLM_MODEL, PRIMARY_LLM_MODEL } from "../config/llm-model.js";
import type { RoleKey } from "../types.js";

interface GenerateParams {
  roleKey: RoleKey;
  query: string;
  reading: string;
  dictionaryName: string;
  definitionJson: string;
  promptTemplate: string;
  promptVersion: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
      }>;
    };
  }>;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_details?: unknown;
    };
  }>;
}

function shouldUseInsufficientDataFallback(definitionJson: string): boolean {
  if (definitionJson.replace(/\s+/g, "").length >= 20) {
    return false;
  }

  try {
    const parsed = JSON.parse(definitionJson) as unknown;
    return !hasExampleSentences(parsed);
  } catch {
    return true;
  }
}

function hasExampleSentences(value: unknown): boolean {
  if (typeof value === "string") {
    return /example|examples|例文|用例/i.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasExampleSentences(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, child]) => /example/i.test(key) || hasExampleSentences(child));
  }

  return false;
}

function buildInsufficientDataReply(query: string): string {
  return `【${query}】\n辞書情報が不足しています。別の単語を調べてみてください。`;
}

export function normalizePromptTemplate(promptTemplate: string): string {
  return promptTemplate.trim();
}

function renderPromptTemplate(promptTemplate: string, params: GenerateParams): string {
  return normalizePromptTemplate(promptTemplate)
    .replaceAll("{{role_key}}", params.roleKey)
    .replaceAll("{{query}}", params.query)
    .replaceAll("{{reading}}", params.reading)
    .replaceAll("{{dictionary_name}}", params.dictionaryName)
    .replaceAll("{{definition_json}}", params.definitionJson)
    .replaceAll("{{prompt_version}}", params.promptVersion);
}

function extractGeminiAnswer(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const answerParts = parts.filter((part) => !part.thought);
  const answerText = answerParts.map((part) => part.text ?? "").join("").trim();

  if (!answerText) {
    throw new Error("Gemini returned empty answer part");
  }

  const thoughtParts = parts.filter((part) => part.thought && typeof part.text === "string" && part.text.trim().length > 0);
  if (thoughtParts.length > 0) {
    console.debug(`[LLM] Gemini reasoning separated → thoughtParts=${thoughtParts.length}`);
  }

  return answerText;
}

function extractOpenRouterAnswer(data: OpenRouterResponse): string {
  const message = data.choices?.[0]?.message;
  const answerText = message?.content?.trim() ?? "";

  if (!answerText) {
    throw new Error("OpenRouter returned empty answer content");
  }

  return answerText;
}

export async function generate(params: GenerateParams): Promise<string> {
  if (shouldUseInsufficientDataFallback(params.definitionJson)) {
    return buildInsufficientDataReply(params.query);
  }

  const prompt = renderPromptTemplate(params.promptTemplate, params);

  try {
    console.log(`[LLM] Gemini started → model=${PRIMARY_LLM_MODEL}`);
    return await callGemini(prompt);
  } catch (err) {
    console.warn(`[LLM] Gemini failed: ${err instanceof Error ? err.message : String(err)} → Check GEMINI_API_KEY or Gemma 4 model access, falling back to OpenRouter`);
    try {
      console.log(`[LLM] OpenRouter started → model=${FALLBACK_LLM_MODEL}`);
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
            includeThoughts: true,
            thinkingLevel: "HIGH",
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini error: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const text = extractGeminiAnswer(data);
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
          max_tokens: 4096,
          exclude: true,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter error: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as OpenRouterResponse;
    const text = extractOpenRouterAnswer(data);
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
