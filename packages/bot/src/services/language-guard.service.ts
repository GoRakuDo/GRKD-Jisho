import type { RoleKey } from "../types.js";

export type LanguageGuardBucket = RoleKey;

export type LanguageGuardViolationKind = "forbidden-script" | "garbage-marker" | "english-ratio";

export interface LanguageGuardViolation {
  kind: LanguageGuardViolationKind;
  label: string;
  sample: string;
}

export type LanguageGuardResult =
  | { ok: true }
  | { ok: false; violations: LanguageGuardViolation[]; reaskReason: string };

const FORBIDDEN_NON_ALLOWED_SCRIPT_PATTERN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{White_Space}]/u;

const KNOWN_FORBIDDEN_SCRIPT_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "Hangul", pattern: /\p{Script=Hangul}/u },
  { label: "Cyrillic", pattern: /\p{Script=Cyrillic}/u },
  { label: "Devanagari", pattern: /\p{Script=Devanagari}/u },
  { label: "Thai", pattern: /\p{Script=Thai}/u },
  { label: "Arabic", pattern: /\p{Script=Arabic}/u },
  { label: "Hebrew", pattern: /\p{Script=Hebrew}/u },
  { label: "Greek", pattern: /\p{Script=Greek}/u },
];

const ALLOWED_MARKDOWN_REPETITIONS = new Set(["```", "---", "***", "===", "..."]);

const ENGLISH_STOPWORDS = new Set([
  "the",
  "is",
  "are",
  "was",
  "were",
  "a",
  "an",
  "of",
  "in",
  "and",
  "to",
  "that",
  "this",
  "with",
  "without",
  "it",
  "its",
  "for",
  "on",
  "at",
  "by",
  "from",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "as",
  "or",
  "not",
  "because",
  "if",
  "then",
  "when",
  "where",
  "why",
  "how",
  "what",
  "can",
  "could",
  "should",
  "would",
  "may",
  "must",
  "yes",
  "no",
]);

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

function tokenizeLatinWords(text: string): string[] {
  return normalizeTextForScanning(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g)?.map((token) => token.toLowerCase()) ?? [];
}

function buildReason(violations: LanguageGuardViolation[]): string {
  return violations.map((violation) => `${violation.label}: ${violation.sample}`).join("; ");
}

function uniqueViolations(violations: LanguageGuardViolation[]): LanguageGuardViolation[] {
  const seen = new Set<string>();
  const unique: LanguageGuardViolation[] = [];

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

function collectForbiddenScriptViolations(text: string): LanguageGuardViolation[] {
  const sample = text.match(FORBIDDEN_NON_ALLOWED_SCRIPT_PATTERN)?.[0];
  if (!sample) {
    return [];
  }

  const label = KNOWN_FORBIDDEN_SCRIPT_PATTERNS.find(({ pattern }) => pattern.test(sample))?.label ?? "Non-allowed script";
  return uniqueViolations([{ kind: "forbidden-script", label, sample }]);
}

function collectGarbageViolations(text: string): LanguageGuardViolation[] {
  const scanText = normalizeTextForScanning(text);
  const violations: LanguageGuardViolation[] = [];

  const atMark = scanText.match(/@{2,}/)?.[0];
  if (atMark) {
    violations.push({ kind: "garbage-marker", label: "Repeated at-mark", sample: atMark });
  }

  const ambSources = scanText.match(/\bAmb sources:/i)?.[0];
  if (ambSources) {
    violations.push({ kind: "garbage-marker", label: "Amb sources", sample: ambSources });
  }

  for (const match of scanText.matchAll(/([^\s])\1{2,}/gu)) {
    const sample = match[0];
    if (ALLOWED_MARKDOWN_REPETITIONS.has(sample)) {
      continue;
    }

    if (sample[0] === "@") {
      continue;
    }

    violations.push({ kind: "garbage-marker", label: "Repeated character run", sample });
  }

  return uniqueViolations(violations);
}

function collectEnglishRatioViolation(text: string): { violation: LanguageGuardViolation; englishRatio: number } | null {
  const latinTokens = tokenizeLatinWords(text).filter((token) => token.length > 0);
  const totalLatinTokenCount = latinTokens.length;

  if (totalLatinTokenCount === 0) {
    return null;
  }

  const englishStopwordCount = latinTokens.filter((token) => ENGLISH_STOPWORDS.has(token)).length;
  const englishRatio = englishStopwordCount / totalLatinTokenCount;

  if (englishRatio > 0.1) {
    return {
      violation: {
        kind: "english-ratio",
        label: "English ratio",
        sample: `${englishStopwordCount}/${totalLatinTokenCount}=${englishRatio.toFixed(3)}`,
      },
      englishRatio,
    };
  }

  return null;
}

function validateDailyJapanese(text: string): LanguageGuardResult {
  const forbiddenViolations = collectForbiddenScriptViolations(text);
  if (forbiddenViolations.length > 0) {
    return { ok: false, violations: forbiddenViolations, reaskReason: buildReason(forbiddenViolations) };
  }

  const garbageViolations = collectGarbageViolations(text);
  if (garbageViolations.length > 0) {
    return { ok: false, violations: garbageViolations, reaskReason: buildReason(garbageViolations) };
  }

  return { ok: true };
}

function validateIndonesian(text: string): LanguageGuardResult {
  const forbiddenViolations = collectForbiddenScriptViolations(text);
  if (forbiddenViolations.length > 0) {
    return { ok: false, violations: forbiddenViolations, reaskReason: buildReason(forbiddenViolations) };
  }

  const garbageViolations = collectGarbageViolations(text);
  if (garbageViolations.length > 0) {
    return { ok: false, violations: garbageViolations, reaskReason: buildReason(garbageViolations) };
  }

  const englishRatioViolation = collectEnglishRatioViolation(text);
  if (englishRatioViolation) {
    return {
      ok: false,
      violations: [englishRatioViolation.violation],
      reaskReason: `英単語比率が ${(englishRatioViolation.englishRatio * 100).toFixed(1)}% で、しきい値 10% を超えました`,
    };
  }

  return { ok: true };
}

export function validateOutputLanguage(text: string, bucket: LanguageGuardBucket): LanguageGuardResult {
  switch (bucket) {
    case "daily-japanese":
      return validateDailyJapanese(text);
    case "indonesian":
      return validateIndonesian(text);
    default: {
      const exhaustiveBucket: never = bucket;
      throw new Error(`Unhandled language guard bucket: ${exhaustiveBucket}`);
    }
  }
}

export function buildLanguageReaskPrompt(originalPrompt: string, bucket: LanguageGuardBucket, result: Exclude<LanguageGuardResult, { ok: true }>): string {
  const allowedLanguageLines = bucket === "daily-japanese"
    ? ["- 日本語", "- Latin 文字全般（英語・ローマ字・インドネシア語）"]
    : ["- インドネシア語", "- 日本語", "- 英語（出力全体の 10% 以内）"];

  const violationLines = result.violations.map((violation) => `- ${violation.label}: ${JSON.stringify(violation.sample)}`);

  return `${originalPrompt}\n\n---\n\n前回の出力は language guard に失敗しました。\n\nbucket: ${bucket}\n許可言語:\n${allowedLanguageLines.join("\n")}\n\n違反:\n${violationLines.join("\n")}\n\n${result.reaskReason}\n辞書データにない意味を追加しないでください。\n許可言語だけを使い、正しい Markdown 形式で最終回答だけを作り直してください。`;
}
