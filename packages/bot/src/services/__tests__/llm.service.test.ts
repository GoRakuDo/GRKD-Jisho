import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  env: {
    GEMINI_API_KEY: "test",
    OPENROUTER_API_KEY: "test",
  },
}));

import { extractFinalReply, generate } from "../llm.service";

describe("extractFinalReply", () => {
  it("reasoning preamble を落として final answer だけ返す", () => {
    const text = `
Drafting internal notes...
Wait, let's double-check.

【これ】
意味:
...`
;

    const result = extractFinalReply(text, "これ");

    expect(result.startsWith("【これ】")).toBe(true);
    expect(result).not.toContain("Drafting internal notes");
    expect(result).not.toContain("double-check");
  });

  it("query が見つからない場合でも最初の 〔【 〕 以降を返す", () => {
    const text = `
some notes
【それ】
意味:
...`;

    expect(extractFinalReply(text, "これ")).toBe("【それ】\n意味:\n...");
  });

  it("定義が薄いときは LLM を呼ばず不足メッセージを返す", async () => {
    const result = await generate({
      roleKey: "pemula",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: "[]",
      promptVersion: "v1",
    });

    expect(result).toBe("【これ】\n辞書情報が不足しています。別の単語を調べてみてください。");
  });
});
