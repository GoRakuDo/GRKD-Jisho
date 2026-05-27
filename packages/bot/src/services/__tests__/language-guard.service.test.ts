import { describe, expect, it } from "vitest";
import { buildLanguageReaskPrompt, validateOutputLanguage } from "../language-guard.service";

describe("validateOutputLanguage", () => {
  it("daily-japanese bucket は日本語 + Markdown を通す", () => {
    const result = validateOutputLanguage("意味:\nこれはテストです\n- 例1\n> Markdown ok", "daily-japanese");

    expect(result.ok).toBe(true);
  });

  it("daily-japanese bucket は Hangul を落とす", () => {
    const result = validateOutputLanguage("意味:\n아니다", "daily-japanese");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.label).toBe("Hangul");
      expect(result.reaskReason).toContain("Hangul");
    }
  });

  it("daily-japanese bucket は @@@ ガービッジを落とす", () => {
    const result = validateOutputLanguage("@@@Kata Kerja@@@", "daily-japanese");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.kind).toBe("garbage-marker");
      expect(result.reaskReason).toContain("@@@");
    }
  });

  it("daily-japanese bucket は Markdown の省略記号 ... を通す", () => {
    const result = validateOutputLanguage("説明...続き", "daily-japanese");

    expect(result.ok).toBe(true);
  });

  it("daily-japanese bucket は 4 連続の同一文字を落とす", () => {
    const result = validateOutputLanguage("説明....続き", "daily-japanese");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.kind).toBe("garbage-marker");
      expect(result.reaskReason).toContain("....");
    }
  });

  it("daily-japanese bucket は Greek を落とす", () => {
    const result = validateOutputLanguage("意味:\nγεια σας", "daily-japanese");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.label).toBe("Greek");
    }
  });

  it.each([
    ["Cyrillic", "значение"],
    ["Devanagari", "नमस्ते"],
  ])("daily-japanese bucket は %s を落とす", (_label: string, sample: string) => {
    const result = validateOutputLanguage(`意味:\n${sample}`, "daily-japanese");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.kind).toBe("forbidden-script");
    }
  });

  it.each([
    ["Armenian", "բարեւ"],
    ["Bengali", "বাংলা"],
    ["Georgian", "გამარჯობა"],
    ["Ethiopic", "ሰላም"],
  ])("daily-japanese bucket は未許可スクリプトの %s を落とす", (_label: string, sample: string) => {
    const result = validateOutputLanguage(`意味:\n${sample}`, "daily-japanese");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.kind).toBe("forbidden-script");
    }
  });

  it("indonesian bucket は日本語 + インドネシア語を通す", () => {
    const result = validateOutputLanguage("意味:\nこれは例です。\nArtinya adalah penjelasan singkat.", "indonesian");

    expect(result.ok).toBe(true);
  });

  it("indonesian bucket は common me- verb を通す", () => {
    const result = validateOutputLanguage("Saya membaca buku ini.", "indonesian");

    expect(result.ok).toBe(true);
  });

  it("indonesian bucket は -al の loan word を通す", () => {
    const result = validateOutputLanguage("Ini adalah penjelasan formal dan normal.", "indonesian");

    expect(result.ok).toBe(true);
  });

  it("indonesian bucket は英単語がちょうど 10% なら通す", () => {
    const result = validateOutputLanguage("kata kata kata kata kata kata kata kata kata the", "indonesian");

    expect(result.ok).toBe(true);
  });

  it("indonesian bucket は英単語が全体の 10% を超えたら落とす", () => {
    const result = validateOutputLanguage("kata kata kata kata kata kata kata kata the and", "indonesian");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.kind).toBe("english-ratio");
      expect(result.reaskReason).toContain("10%");
    }
  });

  it("indonesian bucket は日本語だけでも通す", () => {
    const result = validateOutputLanguage("意味:\nこれはテストです。", "indonesian");

    expect(result.ok).toBe(true);
  });

  it("indonesian bucket は未知の Latin token を許可する", () => {
    const result = validateOutputLanguage("これは日本語です。foobarbaz", "indonesian");

    expect(result.ok).toBe(true);
  });

  it("indonesian bucket は英語寄りの出力を落とす", () => {
    const result = validateOutputLanguage("This is a plain English explanation.", "indonesian");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]?.kind).toBe("english-ratio");
      expect(result.reaskReason).toContain("10%");
    }
  });
});

describe("buildLanguageReaskPrompt", () => {
  it("original prompt の後ろに ReAsk 事情を付け足す", () => {
    const result = validateOutputLanguage("This is a plain English explanation.", "indonesian");

    if (result.ok) {
      throw new Error("expected validation failure");
    }

    const prompt = buildLanguageReaskPrompt("ORIGINAL PROMPT", "indonesian", result);

    expect(prompt).toContain("ORIGINAL PROMPT");
    expect(prompt).toContain("bucket: indonesian");
    expect(prompt).toContain("10%");
  });
});
