import { DEFAULT_LLM_TEMPERATURE, DEFAULT_LLM_TOP_P, FREE_MODEL, LLM_MODELS, type LlmModelEntry } from "../config/llm-models.js";
import { buildLanguageReaskPrompt, validateOutputLanguage, type LanguageGuardResult, type LanguageGuardViolation } from "./language-guard.service.js";
import { buildOutputQualityReaskPrompt, validateOutputQuality, type OutputQualityResult, type OutputQualityViolation } from "./output-quality-guard.service.js";
import type { RoleKey } from "../types.js";

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
    public readonly source: string,
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

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
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

function extractChatCompletionAnswer(data: ChatCompletionResponse, modelId: string): string {
  const message = data.choices?.[0]?.message;
  const answerText = message?.content?.trim() ?? "";

  if (!answerText) {
    throw new Error(`${modelId} returned empty answer content`);
  }

  return answerText;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function getModelFailureHint(model: LlmModelEntry, message: string): string {
  if (message.includes("parse failed")) {
    return `Check ${model.id} response format or CPA availability`;
  }

  if (message.includes("timed out")) {
    return `Check network stability or CPA availability`;
  }

  return `Check ${model.apiKeyEnv} in .env or CPA availability`;
}

async function callChatCompletionsOnce(
  modelEntry: LlmModelEntry,
  url: string,
  apiKey: string,
  prompt: string,
): Promise<string> {
  const controller = new AbortController();
  let connectionTimeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const bodyPayload: Record<string, unknown> = {
      model: modelEntry.id,
      messages: [{ role: "user", content: prompt }],
      temperature: modelEntry.temperature ?? DEFAULT_LLM_TEMPERATURE,
      top_p: modelEntry.topP ?? DEFAULT_LLM_TOP_P,
    };
    if (modelEntry.reasoningEffort) {
      bodyPayload.reasoning_effort = modelEntry.reasoningEffort;
    }

    const connection = fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify(bodyPayload),
    });

    // timeoutMs は「接続タイムアウト」: リクエスト送信〜レスポンスヘッダー受信までのみを打ち切る。
    // 応答ボディの生成待ちはモデル側の生成時間に依存するため無制限に待つ。
    const connectionTimeout = new Promise<never>((_, reject) => {
      connectionTimeoutId = setTimeout(() => {
        controller.abort();
        reject(new DOMException(`${modelEntry.id} request timed out after ${modelEntry.timeoutMs / 1000} seconds`, "AbortError"));
      }, modelEntry.timeoutMs);
    });

    const response = await Promise.race([connection, connectionTimeout]);

    // ヘッダー受信で接続フェーズは完了。ここでタイマーを止めないとボディ受信中の abort が
    // ボディストリームを切ってしまうため、必ず解除してからボディを読む。
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = undefined;

    if (!response.ok) {
      throw new Error(`${modelEntry.id} error: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    return extractChatCompletionAnswer(data, modelEntry.id);
  } finally {
    if (connectionTimeoutId !== undefined) {
      clearTimeout(connectionTimeoutId);
    }
  }
}

export async function callChatCompletions(modelEntry: LlmModelEntry, prompt: string): Promise<string> {
  const apiKey = (process.env as Record<string, string | undefined>)[modelEntry.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`API key for environment variable ${modelEntry.apiKeyEnv} is not configured`);
  }

  const url = `${modelEntry.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= modelEntry.maxAttempts; attempt += 1) {
    try {
      console.log(`[LLM] model=${modelEntry.id} started → attempt=${attempt}/${modelEntry.maxAttempts}`);
      const text = await callChatCompletionsOnce(modelEntry, url, apiKey, prompt);
      console.log(`[LLM] model=${modelEntry.id} success → attempt=${attempt}/${modelEntry.maxAttempts}`);
      return text;
    } catch (err) {
      if (err instanceof SyntaxError) {
        lastError = new Error(`${modelEntry.id} response parse failed after ${attempt}/${modelEntry.maxAttempts} attempts: ${err.message}`);
        if (attempt < modelEntry.maxAttempts) {
          console.warn(`[LLM] model=${modelEntry.id} parse failed → attempt=${attempt}/${modelEntry.maxAttempts}, retrying`);
          continue;
        }
        break;
      }

      if (isAbortError(err)) {
        lastError = new Error(`${modelEntry.id} request timed out after ${modelEntry.timeoutMs / 1000} seconds (attempt ${attempt}/${modelEntry.maxAttempts})`);
        if (attempt < modelEntry.maxAttempts) {
          console.warn(`[LLM] model=${modelEntry.id} timeout → attempt=${attempt}/${modelEntry.maxAttempts}, retrying`);
          continue;
        }
        break;
      }

      throw err;
    }
  }

  throw lastError ?? new Error(`${modelEntry.id} request failed after ${modelEntry.maxAttempts} attempts`);
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

async function validateWithReaskOnModel(
  model: LlmModelEntry,
  renderedPrompt: string,
  params: GenerateParams,
  initialText: string,
): Promise<GuardedValidationFailure | GuardedValidationSuccess> {
  let latestValidation = evaluateGuardrails(initialText, params);
  if (!latestValidation) {
    return { ok: true, text: initialText, reaskAttempts: 0 };
  }

  const failureKinds = new Set<GuardrailFailureCategory>([latestValidation.kind]);

  const guardReaskMax = model.guardReaskMax ?? 2;
  let reaskAttempts = 0;
  for (let attempt = 1; attempt <= guardReaskMax; attempt += 1) {
    reaskAttempts = attempt;
    const reaskPrompt = buildReaskPrompt(renderedPrompt, params.roleKey, latestValidation);

    try {
      console.log(`[LLM] model=${model.id} guard reask started → attempt=${attempt}/${guardReaskMax}`);
      const text = await callChatCompletions(model, reaskPrompt);
      const validation = evaluateGuardrails(text, params);
      if (!validation) {
        console.log(`[LLM] model=${model.id} guard reask success → attempt=${attempt}/${guardReaskMax}`);
        return { ok: true, text, reaskAttempts };
      }

      latestValidation = validation;
      failureKinds.add(validation.kind);
      console.warn(`[LLM] model=${model.id} guard reask failed → attempt=${attempt}/${guardReaskMax}, retrying`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[LLM] model=${model.id} guard reask transport failed → attempt=${attempt}/${guardReaskMax}, error=${message}, retrying`);
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
  /** null = insufficient data fallback (no LLM called), otherwise model id */
  source: string | null;
}

export async function generate(params: GenerateParams, models: LlmModelEntry[] = LLM_MODELS): Promise<GenerateResult> {
  if (shouldUseInsufficientDataFallback(params.definitionJson)) {
    return { text: buildInsufficientDataReply(params.dictionaryForm, params.query), source: null };
  }

  const prompt = renderPromptTemplate(params.promptTemplate, params);
  let lastError: unknown = null;

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i]!;
    const isLast = i === models.length - 1;
    try {
      console.log(`[LLM] model=${model.id} started`);
      const text = await callChatCompletions(model, prompt);
      return { text, source: model.id };
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const hint = getModelFailureHint(model, message);
      if (isLast) {
        console.error(`[LLM] model=${model.id} failed: ${message} → ${hint}`);
      } else {
        const nextModel = models[i + 1]!;
        console.warn(`[LLM] model=${model.id} failed: ${message} → ${hint}, falling back to ${nextModel.id}`);
      }
    }
  }

  throw lastError ?? new Error("All LLM models failed");
}

export async function generateWithLanguageGuardrails(
  params: GenerateParams,
  models: LlmModelEntry[] = LLM_MODELS,
): Promise<GenerateResult> {
  if (shouldUseInsufficientDataFallback(params.definitionJson)) {
    return { text: buildInsufficientDataReply(params.dictionaryForm, params.query), source: null };
  }

  const renderedPrompt = renderPromptTemplate(params.promptTemplate, params);
  let lastGuardError: LanguageGuardError | null = null;
  let lastTransportError: unknown = null;

  for (let i = 0; i < models.length; i += 1) {
    const model = models[i]!;
    const isLast = i === models.length - 1;
    const fallbackUsed = i > 0;

    let initialText: string;
    try {
      console.log(`[LLM] model=${model.id} started`);
      initialText = await callChatCompletions(model, renderedPrompt);
    } catch (err) {
      lastTransportError = err;
      const message = err instanceof Error ? err.message : String(err);
      const hint = getModelFailureHint(model, message);
      if (isLast && !lastGuardError) {
        console.error(`[LLM] model=${model.id} failed: ${message} → ${hint}`);
        throw err;
      }
      const nextModel = models[i + 1];
      console.warn(`[LLM] model=${model.id} failed: ${message} → ${hint}${nextModel ? `, falling back to ${nextModel.id}` : ""}`);
      continue;
    }

    const validationResult = await validateWithReaskOnModel(model, renderedPrompt, params, initialText);
    if (validationResult.ok) {
      return { text: validationResult.text, source: model.id };
    }

    lastGuardError = new LanguageGuardError(
      params.roleKey,
      model.id,
      validationResult.reaskAttempts,
      fallbackUsed,
      validationResult.validation.validation.violations,
      summarizeFailureCategory(validationResult.failureKinds),
    );

    if (!isLast) {
      const nextModel = models[i + 1]!;
      console.warn(`[LLM] model=${model.id} guardrail failed after reasks → falling back to ${nextModel.id}`);
    }
  }

  if (lastGuardError) {
    throw lastGuardError;
  }

  throw lastTransportError ?? new Error("All LLM models failed");
}

/**
 * Free users get exactly one model attempt. The model entry itself carries
 * maxAttempts=1 and guardReaskMax=0, while the one-element array prevents
 * fallback to the paid cascade.
 */
export async function generateFreeWithLanguageGuardrails(
  params: GenerateParams,
): Promise<GenerateResult> {
  return generateWithLanguageGuardrails(params, [FREE_MODEL]);
}
