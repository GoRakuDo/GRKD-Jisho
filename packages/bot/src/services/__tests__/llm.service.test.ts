import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  env: {
    GEMINI_API_KEY: "test",
    OPENROUTER_API_KEY: "test",
  },
}));

import { extractFinalReply, generate } from "../llm.service";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractFinalReply", () => {
  it("reasoning preamble を落として final answer だけ返す", () => {
    const text = `
Drafting internal notes...
Wait, let's double-check.

【これ】
意味:
...`;

    const result = extractFinalReply(text, "これ");

    expect(result.startsWith("【これ】")).toBe(true);
    expect(result).not.toContain("Drafting internal notes");
    expect(result).not.toContain("double-check");
  });

  it("query が見つからない場合でも最初の 【 以降を返す", () => {
    const text = `
some notes
【それ】
意味:
...`;

    expect(extractFinalReply(text, "これ")).toBe("【それ】\n意味:\n...");
  });
});

describe("generate", () => {
  it("定義が薄いときは LLM を呼ばず不足メッセージを返す", async () => {
    const result = await generate({
      roleKey: "pemula",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: "[]",
      promptTemplate: "unused",
      promptVersion: "v1",
    });

    expect(result).toBe("【これ】\n辞書情報が不足しています。別の単語を調べてみてください。");
  });

  it("prompt template の複数プレースホルダをすべて展開して Gemini に渡す", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: "【これ】\n意味:\nこれはテストです" }],
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await generate({
      roleKey: "pemula",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nQ={{query}} / {{query}}\nR={{reading}}\nROLE={{role_key}}\nDICT={{dictionary_name}}\nJSON={{definition_json}}\nVER={{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result.startsWith("【これ】")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    const body = firstCall[1]?.body;
    expect(typeof body).toBe("string");

    const requestBody = JSON.parse(body as string) as {
      contents: Array<{ parts: Array<{ text: string }> }>;
    };

    const promptText = requestBody.contents[0]?.parts[0]?.text ?? "";
    expect(promptText).toContain("Q=これ / これ");
    expect(promptText).toContain("R=これ");
    expect(promptText).toContain("ROLE=pemula");
    expect(promptText).toContain("DICT=test dictionary");
    expect(promptText).toContain("VER=v9");
  });

  it("OpenRouter fallback でも active prompt 本文をそのまま送る", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Gemini failed", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: "【これ】\n意味:\nこれはテストです",
            },
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await generate({
      roleKey: "pemula",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result.startsWith("【これ】")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCall = fetchMock.mock.calls[1] as unknown as [RequestInfo | URL, RequestInit?];
    const fallbackBody = secondCall[1]?.body;
    expect(typeof fallbackBody).toBe("string");

    const requestBody = JSON.parse(fallbackBody as string) as {
      messages: Array<{ content: string }>;
    };

    expect(requestBody.messages[0]?.content).toContain("HELLO=これ");
    expect(requestBody.messages[0]?.content).toContain("v9");
  });
});
