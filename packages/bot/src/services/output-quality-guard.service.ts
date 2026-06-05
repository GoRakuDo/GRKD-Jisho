import type { RoleKey } from "../types.js";

export type OutputQualityGuardBucket = RoleKey;

export type OutputQualityViolationKind =
  | "format-self-report"
  | "safety-self-report"
  | "broken-shape"
  | "completion-only"
  | "assistant-meta"
  | "body-missing"
  | "too-short";

export interface OutputQualityViolation {
  kind: OutputQualityViolationKind;
  label: string;
  sample: string;
}

export type OutputQualityResult =
  | { ok: true }
  | { ok: false; violations: OutputQualityViolation[]; reaskReason: string };

const ALLOWED_MARKDOWN_REPETITIONS = new Set(["```", "---", "***", "===", "..."]);

const FORMAT_SELF_REPORT_PHRASES = [
  "the response adheres strictly to the specified format",
  "i followed the instructions",
  "specified format",
  "task completed",
  "\\boxed{completed}",
];

const FORMAT_SELF_REPORT_REGEX = /(?:adhere[sd]?|compl(?:y|ied)|conform|follow(?:ed|s)?|meet(?:s|ing)?)\s+(?:with\s+)?(?:strictly\s+)?(?:to\s+)?(?:the\s+)?(?:specified|required|given)\s+format/i;
const SAFETY_SELF_REPORT_REGEX = /\b(?:user\s+safety|safety)\s*[:：]\s*(?:safe|ok|passed?)\b/i;
const BROKEN_SHAPE_MARKERS = [
  "```markdown",
  "romaji:",
  "sample translation",
  "カスタムメッセージ",
  "### 1. 主なポイント",
  "### 2. 例文と説明",
  "### 3. 語義・ニュアンス",
  "aturan keseluru:",
];
const JAPANESE_PRONOUN_SUBJECTS = ["これ", "それ", "あれ"];
const PRONOUN_SUBJECT_REPEAT_THRESHOLD = 3;

const ASSISTANT_META_REGEX = /\b(?:As an AI|I cannot|I can't provide)\b/i;
const MIN_EXPLANATORY_BODY_CHARS = 250;

const HEADING_LINE_REGEX = /^(?:#{1,6}\s+.+|【.*】)$/;
const LABEL_WITH_CONTENT_REGEX = /^(読み|意味|わかりやすい説明|ニュアンス|関連語|meaning|explanation|notes|related(?: words?)?|summary)\s*[:：]\s*(.*)$/i;
const LABEL_ONLY_REGEX = /^(読み|意味|わかりやすい説明|ニュアンス|関連語|meaning|explanation|notes|related(?: words?)?|summary)\s*[:：]\s*$/i;

function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ");
}

function stripUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ");
}

function normalizeTextForScanning(text: string): string {
  return stripUrls(stripCodeBlocks(text));
}

function uniqueViolations(violations: OutputQualityViolation[]): OutputQualityViolation[] {
  const seen = new Set<string>();
  const unique: OutputQualityViolation[] = [];

  for (const violation of violations) {
    const key = `${violation.kind}:${violation.label}:${violation.sample}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(violation);
  }

  return unique;
}

function buildReason(violations: OutputQualityViolation[]): string {
  return violations.map((violation) => `${violation.label}: ${violation.sample}`).join("; ");
}

function collectFormatSelfReportViolations(text: string): OutputQualityViolation[] {
  const scanText = normalizeTextForScanning(text).toLowerCase();
  const violations: OutputQualityViolation[] = [];
  let matchedFixedPhrase = false;

  for (const phrase of FORMAT_SELF_REPORT_PHRASES) {
    if (scanText.includes(phrase)) {
      violations.push({ kind: "format-self-report", label: "Format self-report", sample: phrase });
      matchedFixedPhrase = true;
      break;
    }
  }

  if (!matchedFixedPhrase && FORMAT_SELF_REPORT_REGEX.test(text)) {
    violations.push({ kind: "format-self-report", label: "Format self-report", sample: FORMAT_SELF_REPORT_REGEX.source });
  }

  return uniqueViolations(violations);
}

function collectSafetySelfReportViolations(text: string): OutputQualityViolation[] {
  const sample = normalizeTextForScanning(text).match(SAFETY_SELF_REPORT_REGEX)?.[0];
  if (!sample) {
    return [];
  }

  return [{ kind: "safety-self-report", label: "Safety self-report", sample }];
}

function countQuotedTermOccurrences(text: string, term: string): number {
  const quotedForms = [`「${term}」`, `『${term}』`, `**「${term}」**`, `**${term}**`];
  let remainingText = text;
  let count = 0;

  for (const quoted of quotedForms) {
    const matches = remainingText.split(quoted).length - 1;
    count += matches;
    remainingText = remainingText.split(quoted).join("");
  }

  return count;
}

function collectBrokenShapeViolations(params: {
  text: string;
  query: string;
  dictionaryForm: string;
}): OutputQualityViolation[] {
  const scanText = stripUrls(params.text).toLowerCase();
  const violations: OutputQualityViolation[] = [];

  for (const marker of BROKEN_SHAPE_MARKERS) {
    if (scanText.includes(marker.toLowerCase())) {
      violations.push({ kind: "broken-shape", label: "Broken dictionary card shape", sample: marker });
      break;
    }
  }

  const expectedTerms = new Set([params.query, params.dictionaryForm].map((term) => term.trim()).filter((term) => term.length > 0));
  for (const pronoun of JAPANESE_PRONOUN_SUBJECTS) {
    if (expectedTerms.has(pronoun)) {
      continue;
    }

    const count = countQuotedTermOccurrences(params.text, pronoun);
    if (count >= PRONOUN_SUBJECT_REPEAT_THRESHOLD) {
      violations.push({ kind: "broken-shape", label: "Unexpected repeated subject", sample: `「${pronoun}」 x${count}` });
      break;
    }
  }

  return uniqueViolations(violations);
}

function collectCompletionOnlyViolations(text: string): OutputQualityViolation[] {
  const compact = normalizeTextForScanning(text).trim().replace(/\s+/g, " ").toLowerCase().replace(/[.!?。、，!！?？]+$/g, "");
  if (compact === "completed" || compact === "\\boxed{completed}" || compact === "task completed") {
    return [{ kind: "completion-only", label: "Completion only", sample: compact }];
  }

  return [];
}

function collectAssistantMetaViolations(text: string): OutputQualityViolation[] {
  const sample = normalizeTextForScanning(text).match(ASSISTANT_META_REGEX)?.[0];
  if (!sample) {
    return [];
  }

  return [{ kind: "assistant-meta", label: "Assistant meta/refusal", sample }];
}

function extractContentLines(text: string): string[] {
  const scanText = normalizeTextForScanning(text);
  const lines = scanText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (HEADING_LINE_REGEX.test(line)) {
      continue;
    }

    const labelMatch = line.match(LABEL_WITH_CONTENT_REGEX);
    if (labelMatch) {
      const content = labelMatch[2]?.trim() ?? "";
      if (content.length > 0) {
        bodyLines.push(content);
      }
      continue;
    }

    if (LABEL_ONLY_REGEX.test(line)) {
      continue;
    }

    bodyLines.push(line);
  }

  return bodyLines;
}

function collectBodyMissingViolations(text: string): OutputQualityViolation[] {
  const bodyLines = extractContentLines(text);
  if (bodyLines.length > 0) {
    return [];
  }

  return [{ kind: "body-missing", label: "Body missing", sample: "no explanatory body lines" }];
}

function collectTooShortViolations(text: string): OutputQualityViolation[] {
  const bodyLines = extractContentLines(text);
  if (bodyLines.length === 0) {
    return [];
  }

  const bodyText = bodyLines.join(" ").trim();
  const bodyLength = bodyText.replace(/\s+/g, "").length;
  const sentenceCount = bodyText.match(/[。.!?]/g)?.length ?? 0;

  if (bodyLength < MIN_EXPLANATORY_BODY_CHARS) {
    return [{ kind: "too-short", label: "Too short", sample: `${bodyLength} chars / ${sentenceCount} sentences` }];
  }

  return [];
}

export function validateOutputQuality(params: {
  text: string;
  bucket: OutputQualityGuardBucket;
  query: string;
  dictionaryForm: string;
  definitionJson: string;
}): OutputQualityResult {
  const { text } = params;
  // Reserved for future bucket-specific thresholds and query-aware heuristics.
  const violations: OutputQualityViolation[] = [];

  violations.push(...collectFormatSelfReportViolations(text));
  violations.push(...collectSafetySelfReportViolations(text));
  violations.push(...collectBrokenShapeViolations({
    text,
    query: params.query,
    dictionaryForm: params.dictionaryForm,
  }));
  violations.push(...collectCompletionOnlyViolations(text));
  violations.push(...collectAssistantMetaViolations(text));

  const bodyMissingViolations = collectBodyMissingViolations(text);
  if (bodyMissingViolations.length > 0) {
    violations.push(...bodyMissingViolations);
  }

  const tooShortViolations = collectTooShortViolations(text);
  if (tooShortViolations.length > 0) {
    violations.push(...tooShortViolations);
  }

  const unique = uniqueViolations(violations);
  if (unique.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    violations: unique,
    reaskReason: buildReason(unique),
  };
}

export function buildOutputQualityReaskPrompt(originalPrompt: string, result: Exclude<OutputQualityResult, { ok: true }>): string {
  const violationLines = result.violations.map((violation) => `- ${violation.label}: ${JSON.stringify(violation.sample)}`);

  return `${originalPrompt}\n\n---\n\n前回の出力は output quality guard に失敗しました。\n\n理由:\n${violationLines.join("\n")}\n\n${result.reaskReason}\n辞書データにない意味を追加しないでください。\n見出しだけで終わらず、辞書定義に基づく説明本文を必ず含めてください。\n辞書カードの形を守ってください。コードブロック、Romaji、sample translation、カスタムメッセージ、汎用テンプレ見出しは出力しないでください。\n最終回答だけを作り直してください。`;
}
