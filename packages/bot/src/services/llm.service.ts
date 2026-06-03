import { env } from "../config/env.js";
import { DEFAULT_LLM_TEMPERATURE, DEFAULT_LLM_TOP_P, FALLBACK_LLM_MODEL, PRIMARY_LLM_MODEL } from "../config/llm-model.js";
import { buildLanguageReaskPrompt, validateOutputLanguage, type LanguageGuardResult, type LanguageGuardViolation } from "./language-guard.service.js";
import { buildOutputQualityReaskPrompt, validateOutputQuality, type OutputQualityResult, type OutputQualityViolation } from "./output-quality-guard.service.js";
import type { RoleKey } from "../types.js";

const GEMINI_TIMEOUT_MS = 60_000;
const OPENROUTER_TIMEOUT_MS = 150_000;
const OPENROUTER_MAX_ATTEMPTS = 3;

type LanguageGuardProvider = "gemini" | "openrouter";
type GuardrailFailureCategory = "language" | "quality" | "mixed";
type GuardrailViolation = LanguageGuardViolation | OutputQualityViolation;

interface GenerateParams {
  roleKey: RoleKey;
  query: string;
  dictionaryForm: string;
  reading: string;
  dictionaryName: string;
  definitionJson: string;
  promptTemplate: string;
  promptVersion: string;
}

export class LanguageGuardError extends Error {
  constructor(
    public readonly bucket: RoleKey,
    public readonly source: "gemini" | "openrouter",
    public readonly reaskAttempts: number,
    public readonly fallbackUsed: boolean,
    public readonly violations: GuardrailViolation[],
    public readonly failureCategory: GuardrailFailureCategory = "language",
    message = "Language guard validation failed",
  ) {
    super(message);
    this.name = "LanguageGuardError";
  }
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

function buildInsufficientDataReply(dictionaryForm: string, fallback: string): string {
  const label = dictionaryForm || fallback;
  return `【${label}】\n辞書情報が不足しています。別の単語を調べてみてください。`;
}

export function normalizePromptTemplate(promptTemplate: string): string {
  return promptTemplate.trim();
}

function renderPromptTemplate(promptTemplate: string, params: GenerateParams): string {
  return normalizePromptTemplate(promptTemplate)
    .replaceAll("{{role_key}}", params.roleKey)
    .replaceAll("{{query}}", params.query)
    .replaceAll("{{dictionary_form}}", params.dictionaryForm)
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

function getProviderLabel(provider: LanguageGuardProvider): string {
  return provider === "gemini" ? "Gemini" : "OpenRouter";
}

async function callLanguageModel(prompt: string, provider: LanguageGuardProvider): Promise<string> {
  return provider === "gemini" ? callGemini(prompt) : callOpenRouter(prompt);
}

type GuardFailure =
  | { kind: "language"; validation: Exclude<LanguageGuardResult, { ok: true }> }
  | { kind: "quality"; validation: Exclude<OutputQualityResult, { ok: true }> };

interface GuardedValidationFailure {
  ok: false;
  validation: GuardFailure;
  reaskAttempts: number;
  failureKinds: Set<GuardrailFailureCategory>;
}

interface GuardedValidationSuccess {
  ok: true;
  text: string;
  reaskAttempts: number;
}

async function validateWithReaskOnProvider(
  provider: LanguageGuardProvider,
  renderedPrompt: string,
  params: GenerateParams,
  initialText: string,
): Promise<GuardedValidationFailure | GuardedValidationSuccess> {
  let latestValidation = evaluateGuardrails(initialText, params);
  if (!latestValidation) {
    return { ok: true, text: initialText, reaskAttempts: 0 };
  }

  const failureKinds = new Set<GuardrailFailureCategory>([latestValidation.kind]);

  let reaskAttempts = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    reaskAttempts = attempt;
    const reaskPrompt = buildReaskPrompt(renderedPrompt, params.roleKey, latestValidation);

    try {
      console.log(`[LLM] ${getProviderLabel(provider)} guard reask started → attempt=${attempt}/2`);
      const text = await callLanguageModel(reaskPrompt, provider);
      const validation = evaluateGuardrails(text, params);
      if (!validation) {
        console.log(`[LLM] ${getProviderLabel(provider)} guard reask success → attempt=${attempt}/2`);
        return { ok: true, text, reaskAttempts };
      }

      latestValidation = validation;
      failureKinds.add(validation.kind);
      console.warn(`[LLM] ${getProviderLabel(provider)} guard reask failed → attempt=${attempt}/2, retrying`);
    } catch (err) {
      console.warn(`[LLM] ${getProviderLabel(provider)} guard reask transport failed → attempt=${attempt}/2, error=${err instanceof Error ? err.message : String(err)}, retrying`);
    }
  }

  return { ok: false, validation: latestValidation, reaskAttempts, failureKinds };
}

function evaluateGuardrails(text: string, params: GenerateParams): GuardFailure | null {
  const languageValidation = validateOutputLanguage(text, params.roleKey);
  if (!languageValidation.ok) {
    return { kind: "language", validation: languageValidation };
  }

  const qualityValidation = validateOutputQuality({
    text,
    bucket: params.roleKey,
    query: params.query,
    dictionaryForm: params.dictionaryForm,
    definitionJson: params.definitionJson,
  });
  if (!qualityValidation.ok) {
    return { kind: "quality", validation: qualityValidation };
  }

  return null;
}

function buildReaskPrompt(renderedPrompt: string, bucket: RoleKey, failure: GuardFailure): string {
  return failure.kind === "language"
    ? buildLanguageReaskPrompt(renderedPrompt, bucket, failure.validation)
    : buildOutputQualityReaskPrompt(renderedPrompt, failure.validation);
}

function summarizeFailureCategory(failureKinds: Set<GuardrailFailureCategory>): GuardrailFailureCategory {
  if (failureKinds.size > 1) {
    return "mixed";
  }

  return failureKinds.values().next().value ?? "language";
}

export interface GenerateResult {
  text: string;
  /** null = insufficient data fallback (no LLM called) */
  source: "gemini" | "openrouter" | null;
}

export async function generate(params: GenerateParams): Promise<GenerateResult> {
  if (shouldUseInsufficientDataFallback(params.definitionJson)) {
    return { text: buildInsufficientDataReply(params.dictionaryForm, params.query), source: null };
  }

  const prompt = renderPromptTemplate(params.promptTemplate, params);

  try {
    console.log(`[LLM] Gemini started → model=${PRIMARY_LLM_MODEL}`);
    const text = await callGemini(prompt);
    return { text, source: "gemini" };
  } catch (err) {
    console.warn(`[LLM] Gemini failed: ${err instanceof Error ? err.message : String(err)} → Check GEMINI_API_KEY or Gemma 4 model access, falling back to OpenRouter`);
    try {
      const text = await callOpenRouter(prompt);
      return { text, source: "openrouter" };
    } catch (openRouterErr) {
      console.error(`[LLM] OpenRouter failed: ${openRouterErr instanceof Error ? openRouterErr.message : String(openRouterErr)} → Check OPENROUTER_API_KEY or OpenRouter model access`);
      throw openRouterErr;
    }
  }
}

export async function generateWithLanguageGuardrails(params: GenerateParams): Promise<GenerateResult> {
  const renderedPrompt = renderPromptTemplate(params.promptTemplate, params);
  const initial = await generate(params);

  if (initial.source === null) {
    return initial;
  }

  const initialAttempt = await validateWithReaskOnProvider(initial.source, renderedPrompt, params, initial.text);
  if (initialAttempt.ok) {
    return { text: initialAttempt.text, source: initial.source };
  }

  if (initial.source === "openrouter") {
    throw new LanguageGuardError(params.roleKey, initial.source, initialAttempt.reaskAttempts, true, initialAttempt.validation.validation.violations, summarizeFailureCategory(initialAttempt.failureKinds));
  }

  const fallbackText = await callOpenRouter(renderedPrompt);
  const fallbackAttempt = await validateWithReaskOnProvider("openrouter", renderedPrompt, params, fallbackText);
  if (fallbackAttempt.ok) {
    return { text: fallbackAttempt.text, source: "openrouter" };
  }

  throw new LanguageGuardError(params.roleKey, "openrouter", fallbackAttempt.reaskAttempts, true, fallbackAttempt.validation.validation.violations, summarizeFailureCategory(fallbackAttempt.failureKinds));
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function callGemini(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${PRIMARY_LLM_MODEL}:generateContent`);

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
          temperature: DEFAULT_LLM_TEMPERATURE,
          topP: DEFAULT_LLM_TOP_P,
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
    if (isAbortError(err)) {
      throw new Error(`Gemini request timed out after ${GEMINI_TIMEOUT_MS / 1000} seconds`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenRouter(prompt: string): Promise<string> {
  let lastTimeoutError: Error | null = null;

  for (let attempt = 1; attempt <= OPENROUTER_MAX_ATTEMPTS; attempt += 1) {
    try {
      console.log(`[LLM] OpenRouter started → model=${FALLBACK_LLM_MODEL} attempt=${attempt}/${OPENROUTER_MAX_ATTEMPTS}`);
      const text = await callOpenRouterOnce(prompt);
      console.log(`[LLM] OpenRouter success → model=${FALLBACK_LLM_MODEL} attempt=${attempt}/${OPENROUTER_MAX_ATTEMPTS}`);
      return text;
    } catch (err) {
      if (!isAbortError(err)) {
        throw err;
      }

      lastTimeoutError = new Error(`OpenRouter request timed out after ${OPENROUTER_TIMEOUT_MS / 1000} seconds (attempt ${attempt}/${OPENROUTER_MAX_ATTEMPTS})`);
      if (attempt < OPENROUTER_MAX_ATTEMPTS) {
        console.warn(`[LLM] OpenRouter timeout → attempt=${attempt}/${OPENROUTER_MAX_ATTEMPTS}, retrying`);
        continue;
      }

      throw lastTimeoutError;
    }
  }

  throw lastTimeoutError ?? new Error(`OpenRouter request timed out after ${OPENROUTER_TIMEOUT_MS / 1000} seconds`);
}

async function callOpenRouterOnce(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

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
        temperature: DEFAULT_LLM_TEMPERATURE,
        top_p: DEFAULT_LLM_TOP_P,
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
    return extractOpenRouterAnswer(data);
  } finally {
    clearTimeout(timeoutId);
  }
}
