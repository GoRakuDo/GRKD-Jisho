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

  it("辞書カードの形が壊れた長文ハルシネーションを落とす", () => {
    const result = validateOutputQuality({
      text: "```markdown\n# 表 (おもて) ー Dalam Nuansa Bahasa Indonesia\n\n### 1. 主なポイント\n- **「それ」**は文の意味を明確にする役割を持ちます。\n- **「それ」**は確認の意味を伝えることがあります。\n- **「それ」**だけで意味が不明確な場合もあります。\n\n**カスタムメッセージ（日本語）:**\nこの文脈では「それ」が重要です。\n```\n\n**Konten penjelasan Jepang (sample translation):**\nこれはサンプルです。\n\n**Romaji:**\nKata \"それ\" wa hanashi wo kanou ni suru kata desu. この長い文章は250文字を超えるため、単純な短文チェックだけでは落とせません。だから辞書カードの形が壊れている marker を見て ReAsk へ戻す必要があります。",
      bucket: "indonesian",
      query: "表",
      dictionaryForm: "表",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((violation) => violation.kind === "broken-shape")).toBe(true);
    }
  });

  it("検索語ではない代名詞が主役として繰り返される出力を落とす", () => {
    const result = validateOutputQuality({
      text: "## 【表 (おもて) ー Dalam Nuansa Bahasa Indonesia】\n\n**〘名詞〙 Kata Benda**\n**Intuisi Inti:** Penjelasan ini tampak panjang, tetapi subjeknya bergeser. **「それ」** dipakai sebagai topik utama. **「それ」** dijelaskan sebagai kata yang menunjuk konteks. **「それ」** juga dipakai lagi sebagai pusat semua contoh. Karena query sebenarnya adalah 表, pengulangan ini menunjukkan jawaban sedang membahas kata lain, bukan data kamus yang dicari. Kalimat ini dibuat cukup panjang agar tidak jatuh oleh aturan too-short. Fokus guard ini adalah bentuk kartu dan grounding sederhana.",
      bucket: "indonesian",
      query: "表",
      dictionaryForm: "表",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((violation) => violation.kind === "broken-shape")).toBe(true);
    }
  });

  it("検索語ではない代名詞引用が2回だけなら形崩れ扱いしない", () => {
    const result = validateOutputQuality({
      text: "## 【表 (おもて) ー Dalam Nuansa Bahasa Indonesia】\n\n**〘名詞〙 Kata Benda**\n**Intuisi Inti:** 表 berarti sisi luar atau permukaan yang terlihat dari suatu benda. Dalam kalimat contoh, kita boleh menyebut **「それ」** sekali untuk menjelaskan konteks percakapan, lalu menyebut **「それ」** sekali lagi sebagai bagian dari contoh pembanding. Namun fokus utama tetap 表, yaitu bagian luar, permukaan, atau sisi depan yang tampak. Penjelasan ini tetap membahas kata yang dicari, bukan mengganti topik menjadi kata ganti lain. Kalimat dibuat cukup panjang agar melewati batas minimal kualitas.",
      bucket: "indonesian",
      query: "表",
      dictionaryForm: "表",
      definitionJson: "{}",
    });

    expect(result.ok).toBe(true);
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
