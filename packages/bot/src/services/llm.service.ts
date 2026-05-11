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
      }>;
    };
  }>;
}

function shouldUseInsufficientDataFallback(definitionJson: string): boolean {
  const compact = definitionJson.replace(/\s+/g, "");
  return compact.length < 20 && !/example/i.test(definitionJson);
}

function buildInsufficientDataReply(query: string): string {
  return `【${query}】\n辞書情報が不足しています。別の単語を調べてみてください。`;
}

function renderPromptTemplate(promptTemplate: string, params: GenerateParams): string {
  return promptTemplate
    .replaceAll("{{role_key}}", params.roleKey)
    .replaceAll("{{query}}", params.query)
    .replaceAll("{{reading}}", params.reading)
    .replaceAll("{{dictionary_name}}", params.dictionaryName)
    .replaceAll("{{definition_json}}", params.definitionJson)
    .replaceAll("{{prompt_version}}", params.promptVersion);
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

export async function generate(params: GenerateParams): Promise<string> {
  if (shouldUseInsufficientDataFallback(params.definitionJson)) {
    return buildInsufficientDataReply(params.query);
  }

  const prompt = renderPromptTemplate(params.promptTemplate, params);

  try {
    console.log(`[LLM] Gemini started → model=${PRIMARY_LLM_MODEL}`);
    return extractFinalReply(await callGemini(prompt), params.query);
  } catch (err) {
    console.warn(`[LLM] Gemini failed: ${err instanceof Error ? err.message : String(err)} → Check GEMINI_API_KEY or Gemma 4 model access, falling back to OpenRouter`);
    try {
      console.log(`[LLM] OpenRouter started → model=${FALLBACK_LLM_MODEL}`);
      return extractFinalReply(await callOpenRouter(prompt), params.query);
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
