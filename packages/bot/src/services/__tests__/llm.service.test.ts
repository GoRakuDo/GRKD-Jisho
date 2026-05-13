import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  env: {
    GEMINI_API_KEY: "test",
    OPENROUTER_API_KEY: "test",
  },
}));

import { generate, normalizePromptTemplate } from "../llm.service";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizePromptTemplate", () => {
  it("prompt を trim するだけで legacy marker を足さない", () => {
    const prompt = normalizePromptTemplate("\nSYSTEM\nBASE PROMPT\n");

    expect(prompt).toBe("SYSTEM\nBASE PROMPT");
    expect(prompt).not.toContain("ANSWER:");
    expect(prompt).not.toContain("REASONING:");
  });
});

describe("generate", () => {
  it("定義が薄いときは LLM を呼ばず不足メッセージを返す", async () => {
    const result = await generate({
      roleKey: "daily-japanese",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: "[]",
      promptTemplate: "unused",
      promptVersion: "v1",
    });

    expect(result).toBe("【これ】\n辞書情報が不足しています。別の単語を調べてみてください。");
  });

  it.each([
    "{}",
    '{"a":"b","c":"d"}',
  ])("JSON が短く example が無いと不足判定される: %s", async (definitionJson) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await generate({
      roleKey: "indonesian",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson,
      promptTemplate: "unused",
      promptVersion: "v1",
    });

    expect(result).toBe("【これ】\n辞書情報が不足しています。別の単語を調べてみてください。");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    '{"example":"sentence"}',
    '{"notes":"用例があります"}',
    '{"items":[{"example":"foo"}]}',
  ])("JSON に example 情報があれば不足判定しない: %s", async (definitionJson) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { text: "【これ】\n意味:\nこれはテストです", thought: false },
            ],
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await generate({
      roleKey: "indonesian",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson,
      promptTemplate: "SYSTEM",
      promptVersion: "v1",
    });

    expect(result).toBe("【これ】\n意味:\nこれはテストです");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Gemini は thought parts を分けて answer だけ返す", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { text: "internal reasoning", thought: true },
              { text: "【これ】\n意味:\nこれはテストです", thought: false },
            ],
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await generate({
      roleKey: "daily-japanese",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nQ={{query}} / {{query}}\nR={{reading}}\nBUCKET={{role_key}}\nDICT={{dictionary_name}}\nJSON={{definition_json}}\nVER={{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result).toBe("【これ】\n意味:\nこれはテストです");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    const body = firstCall[1]?.body;
    expect(typeof body).toBe("string");

    const requestBody = JSON.parse(body as string) as {
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig?: { thinkingConfig?: { includeThoughts?: boolean; thinkingLevel?: string } };
    };

    const promptText = requestBody.contents[0]?.parts[0]?.text ?? "";
    expect(promptText).toContain("Q=これ / これ");
    expect(promptText).toContain("R=これ");
    expect(promptText).toContain("BUCKET=daily-japanese");
    expect(promptText).toContain("DICT=test dictionary");
    expect(promptText).toContain("VER=v9");
    expect(promptText).not.toContain("ANSWER:");
    expect(promptText).not.toContain("REASONING:");
    expect(requestBody.generationConfig?.thinkingConfig?.includeThoughts).toBe(true);
  });

  it("OpenRouter fallback は reasoning.exclude=true で content だけ使う", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Gemini failed", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: "【これ】\n意味:\nこれはテストです",
              reasoning: "hidden reasoning",
            },
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await generate({
      roleKey: "indonesian",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result).toBe("【これ】\n意味:\nこれはテストです");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCall = fetchMock.mock.calls[1] as unknown as [RequestInfo | URL, RequestInit?];
    const fallbackBody = secondCall[1]?.body;
    expect(typeof fallbackBody).toBe("string");

    const requestBody = JSON.parse(fallbackBody as string) as {
      messages: Array<{ content: string }>;
      reasoning?: { max_tokens?: number; exclude?: boolean };
    };

    expect(requestBody.messages[0]?.content).toContain("HELLO=これ");
    expect(requestBody.messages[0]?.content).toContain("v9");
    expect(requestBody.reasoning?.max_tokens).toBe(4096);
    expect(requestBody.reasoning?.exclude).toBe(true);
  });

  it("OpenRouter は timeout 時に 3 回までリトライする", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Gemini failed", { status: 500 }))
      .mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));

    vi.stubGlobal("fetch", fetchMock);

    await expect(generate({
      roleKey: "indonesian",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    })).rejects.toThrow(/OpenRouter request timed out after 150 seconds/i);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("OpenRouter の 500 エラーは即失敗し、リトライしない", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Gemini failed", { status: 500 }))
      .mockResolvedValueOnce(new Response("OpenRouter failed", { status: 500 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(generate({
      roleKey: "indonesian",
      query: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    })).rejects.toThrow(/OpenRouter error: 500/i);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
