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
      text: "## 【は】\n\n意味:\n助詞",
      bucket: "daily-japanese",
      query: "は",
      dictionaryForm: "は",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((violation) => violation.kind === "too-short")).toBe(true);
    }
  });

  it("十分な本文は通す", () => {
    const result = validateOutputQuality({
      text: "## 【は】\n\n意味:\n助詞です。文の主題を示します。",
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
