import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  env: {
    GEMINI_API_KEY: "test",
    OPENROUTER_API_KEY: "test",
  },
}));

import { extractFinalReply, generate, validateJishoOutput } from "../llm.service";

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

  it("不正な出力は validator で弾かれる", () => {
    expect(validateJishoOutput("【これ】\n意味:\nこれは正常です", "これ")).toBe(true);
    expect(validateJishoOutput("【[abc]】\n意味:\nこれは正常です", "[abc]")).toBe(true);
    expect(validateJishoOutput("Structured JSON-like data from Sanseido Dictionary 8th Ed.\n【これ】\n意味:\n...", "これ")).toBe(false);
    expect(validateJishoOutput("【これ】\n" + "a".repeat(3501), "これ")).toBe(false);
  });

  it("固定システムプロンプトを先頭注入して Gemini に渡す", async () => {
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
      promptVersion: "v1",
    });

    expect(result.startsWith("【これ】")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    const body = firstCall[1]?.body;
    expect(typeof body).toBe("string");

    const requestBody = JSON.parse(body as string) as {
      contents: Array<{ parts: Array<{ text: string }> }>;
    };

    expect(requestBody.contents[0]?.parts[0]?.text.startsWith("SYSTEM:\nKamu adalah renderer kartu kamus final untuk Discord.")).toBe(true);
  });

  it("不正出力は一度だけ emergency prompt で再試行する", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: "Structured JSON-like data from Sanseido Dictionary 8th Ed.\nMain Meaning 1...\nUser Role...\nStrictly based on dictionary?" }],
            },
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      promptVersion: "v1",
    });

    expect(result.startsWith("【これ】")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryCall = fetchMock.mock.calls[1] as unknown as [RequestInfo | URL, RequestInit?];
    const retryBody = JSON.parse(retryCall[1]?.body as string) as {
      contents: Array<{ parts: Array<{ text: string }> }>;
    };

    expect(retryBody.contents[0]?.parts[0]?.text.startsWith("Perbaiki output sebelumnya.")).toBe(true);
  });

  it("固定システムプロンプトを OpenRouter fallback にも渡す", async () => {
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
      promptVersion: "v1",
    });

    expect(result.startsWith("【これ】")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCall = fetchMock.mock.calls[1] as unknown as [RequestInfo | URL, RequestInit?];
    const fallbackBody = secondCall[1]?.body;
    expect(typeof fallbackBody).toBe("string");

    const requestBody = JSON.parse(fallbackBody as string) as {
      messages: Array<{ content: string }>;
    };

    expect(requestBody.messages[0]?.content.startsWith("SYSTEM:\nKamu adalah renderer kartu kamus final untuk Discord.")).toBe(true);
  });
});
