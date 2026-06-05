import { describe, expect, it } from "vitest";
import { buildOutputQualityReaskPrompt, validateOutputQuality } from "../output-quality-guard.service";

describe("validateOutputQuality", () => {
  it("format self-report を落とす", () => {
    const result = validateOutputQuality({
      text: "The response adheres strictly to the specified format. \\boxed{Completed}",
      bucket: "daily-japanese",
      query: "これ",
      dictionaryForm: "これ",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.kind).toBe("format-self-report");
    }
  });

  it("regex-only の self-report も落とす", () => {
    const result = validateOutputQuality({
      text: "I complied with the required format.",
      bucket: "daily-japanese",
      query: "これ",
      dictionaryForm: "これ",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((violation) => violation.kind === "format-self-report")).toBe(true);
    }
  });

  it("completion only を落とす", () => {
    const result = validateOutputQuality({
      text: "Completed",
      bucket: "daily-japanese",
      query: "これ",
      dictionaryForm: "これ",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.kind).toBe("completion-only");
    }
  });

  it("assistant meta を落とす", () => {
    const result = validateOutputQuality({
      text: "As an AI, I cannot provide that.",
      bucket: "indonesian",
      query: "ini",
      dictionaryForm: "ini",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.kind).toBe("assistant-meta");
    }
  });

  it("見出しだけの出力を落とす", () => {
    const result = validateOutputQuality({
      text: "## 【利益（りえき）— 日本語の感覚】",
      bucket: "daily-japanese",
      query: "利益",
      dictionaryForm: "利益",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((violation) => violation.kind === "body-missing")).toBe(true);
    }
  });

  it("短すぎる本文を落とす", () => {
    const result = validateOutputQuality({
      text: "## 【表】\n\nUser Safety: safe",
      bucket: "daily-japanese",
      query: "表",
      dictionaryForm: "表",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((violation) => violation.kind === "too-short")).toBe(true);
      expect(result.violations.some((violation) => violation.kind === "safety-self-report")).toBe(true);
    }
  });

  it("安全判定だけの self-report を落とす", () => {
    const result = validateOutputQuality({
      text: "User Safety: safe",
      bucket: "indonesian",
      query: "表",
      dictionaryForm: "表",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((violation) => violation.kind === "safety-self-report")).toBe(true);
    }
  });

  it("十分な本文は通す", () => {
    const result = validateOutputQuality({
      text: "## 【は】\n\n意味:\n「は」は、文の中で話題にしたいものを前に出す助詞です。たとえば「私は学生です」なら、「私」についてこれから説明します、という合図になります。新しい情報を強く出すというより、すでに話題に乗っているものを静かに取り上げる感じです。会話では、相手と共有しているテーマを続けるときにも使います。インドネシア語に一語で完全対応する語はないので、文全体の役割で見るのが大事です。短い語ですが、文の焦点を決める大事な部品です。何を主役として扱うかを示すため、前後の文脈と一緒に読むと自然に理解できます。特に長い会話では重要です。",
      bucket: "daily-japanese",
      query: "は",
      dictionaryForm: "は",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(true);
  });
});

describe("buildOutputQualityReaskPrompt", () => {
  it("元の prompt の後ろに品質違反の説明を付け足す", () => {
    const result = validateOutputQuality({
      text: "As an AI, I cannot provide that.",
      bucket: "indonesian",
      query: "ini",
      dictionaryForm: "ini",
      definitionJson: "{}",
    });

    if (result.ok) {
      throw new Error("expected validation failure");
    }

    const prompt = buildOutputQualityReaskPrompt("ORIGINAL PROMPT", result);

    expect(prompt).toContain("ORIGINAL PROMPT");
    expect(prompt).toContain("output quality guard");
    expect(prompt).toContain("As an AI");
  });
});
