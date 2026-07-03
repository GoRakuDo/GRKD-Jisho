import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LLM_TEMPERATURE, DEFAULT_LLM_TOP_P } from "../../config/llm-model";

vi.mock("../../config/env", () => ({
  env: {
    GEMINI_API_KEY: "test",
    OPENROUTER_API_KEY: "test",
  },
}));

import { generate, generateWithLanguageGuardrails, LanguageGuardError, normalizePromptTemplate } from "../llm.service";

const VALID_DAILY_RESPONSE = "意味:\n「これ」は、話している人と聞いている人の近くにある物や、今まさに話題にしている内容を指す言葉です。たとえば机の上の本を指して『これは本です』と言えば、その本を中心に説明しています。物だけでなく、直前に出た話題や状況をまとめて指すときにも使います。短い語ですが、会話の焦点を相手に見せる大事な役割があります。文脈の中で何を指しているかを確認すると、自然に理解できます。前の発言全体をまとめて受けることもあり、『これが問題です』のように状況そのものを指す場合もあります。指している対象が近くの物なのか、話題なのかを見分けると、意味がかなり取りやすくなります。";

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
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: "[]",
      promptTemplate: "unused",
      promptVersion: "v1",
    });

    expect(result.text).toBe("【これ】\n辞書情報が不足しています。別の単語を調べてみてください。");
    expect(result.source).toBeNull();
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
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson,
      promptTemplate: "unused",
      promptVersion: "v1",
    });

    expect(result.text).toBe("【これ】\n辞書情報が不足しています。別の単語を調べてみてください。");
    expect(result.source).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    '{"example":"sentence"}',
    '{"notes":"用例があります"}',
    '{"items":[{"example":"foo"}]}',
  ])("JSON に example 情報があれば不足判定しない: %s", async (definitionJson) => {
    // OpenRouter is now primary — mock OpenRouter (choices format)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: `【これ】\n${VALID_DAILY_RESPONSE}`,
            reasoning: "hidden",
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
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson,
      promptTemplate: "SYSTEM",
      promptVersion: "v1",
    });

    expect(result.text).toBe(`【これ】\n${VALID_DAILY_RESPONSE}`);
    expect(result.source).toBe("openrouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Gemini は thought parts を分けて answer だけ返す（OpenRouter失敗→Gemini fallback）", async () => {
    // OpenRouter fails → Gemini with thought parts
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("OpenRouter failed", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "internal reasoning", thought: true },
                { text: `【これ】\n${VALID_DAILY_RESPONSE}`, thought: false },
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
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nQ={{query}} / {{query}}\nR={{reading}}\nBUCKET={{role_key}}\nDICT={{dictionary_name}}\nJSON={{definition_json}}\nVER={{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result.text).toBe(`【これ】\n${VALID_DAILY_RESPONSE}`);
    expect(result.source).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const geminiCall = fetchMock.mock.calls[1] as unknown as [RequestInfo | URL, RequestInit?];
    const body = geminiCall[1]?.body;
    expect(typeof body).toBe("string");

    const requestBody = JSON.parse(body as string) as {
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig?: {
        temperature?: number;
        topP?: number;
        thinkingConfig?: { includeThoughts?: boolean; thinkingLevel?: string };
      };
    };

    const promptText = requestBody.contents[0]?.parts[0]?.text ?? "";
    expect(promptText).toContain("Q=これ / これ");
    expect(promptText).toContain("R=これ");
    expect(promptText).toContain("BUCKET=daily-japanese");
    expect(promptText).toContain("DICT=test dictionary");
    expect(promptText).toContain("VER=v9");
    expect(promptText).not.toContain("ANSWER:");
    expect(promptText).not.toContain("REASONING:");
    expect(requestBody.generationConfig?.temperature).toBe(DEFAULT_LLM_TEMPERATURE);
    expect(requestBody.generationConfig?.topP).toBe(DEFAULT_LLM_TOP_P);
    expect(requestBody.generationConfig?.thinkingConfig?.includeThoughts).toBe(true);
  });

  it("OpenRouter は reasoning.exclude=true で content だけ使う（primary）", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: `【これ】\n${VALID_DAILY_RESPONSE}`,
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
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result.text).toBe(`【これ】\n${VALID_DAILY_RESPONSE}`);
    expect(result.source).toBe("openrouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    const requestBody = firstCall[1]?.body as string;
    expect(typeof requestBody).toBe("string");

    const parsed = JSON.parse(requestBody) as {
      messages: Array<{ content: string }>;
      temperature?: number;
      top_p?: number;
      reasoning?: { max_tokens?: number; exclude?: boolean };
    };

    expect(parsed.messages[0]?.content).toContain("HELLO=これ");
    expect(parsed.messages[0]?.content).toContain("v9");
    expect(parsed.temperature).toBe(DEFAULT_LLM_TEMPERATURE);
    expect(parsed.top_p).toBe(DEFAULT_LLM_TOP_P);
    expect(parsed.reasoning?.max_tokens).toBe(4096);
    expect(parsed.reasoning?.exclude).toBe(true);
  });

  it("OpenRouter の JSON parse failure は retry する（primary）", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: `【これ】\n${VALID_DAILY_RESPONSE}`,
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
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result.text).toBe(`【これ】\n${VALID_DAILY_RESPONSE}`);
    expect(result.source).toBe("openrouter");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("OpenRouter の JSON parse failure が 2 回続いたら Gemini に fallback する", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not json 1", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("not json 2", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("not json 3", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      // Gemini fallback also fails
      .mockResolvedValueOnce(new Response("Gemini failed", { status: 500 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(generate({
      roleKey: "indonesian",
      query: "これ",
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    })).rejects.toThrow(/Gemini error: 500/i);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("OpenRouter は timeout 時に 2 回までリトライし、Gemini に fallback してさらに 3 回リトライする", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));

    vi.stubGlobal("fetch", fetchMock);

    await expect(generate({
      roleKey: "indonesian",
      query: "これ",
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    })).rejects.toThrow(/Gemini request timed out after 60 seconds/i);

    // OpenRouter 2 attempts (1+1) + Gemini 3 attempts (1+2) = 5
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("language guard 通過後に output quality guard が失敗したら OpenRouter で ReAsk する（primary）", async () => {
    // OpenRouter primary: first response fails quality guard, reask succeeds
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: "The response adheres strictly to the specified format. \\boxed{Completed}",
              reasoning: "hidden",
            },
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: VALID_DAILY_RESPONSE,
              reasoning: "hidden",
            },
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await generateWithLanguageGuardrails({
      roleKey: "daily-japanese",
      query: "これ",
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result.text).toBe(VALID_DAILY_RESPONSE);
    expect(result.source).toBe("openrouter");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("OpenRouter で output quality guard 失敗 → Gemini に fallback する", async () => {
    // OpenRouter fails quality guard + 2 reasks, then Gemini fallback (Gemini format responses)
    const fetchMock = vi.fn()
      // OpenRouter primary: initial + 2 reasks all fail quality (OpenRouter format)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: "The response adheres strictly to the specified format. \\boxed{Completed}",
            reasoning: "hidden",
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: "The response adheres strictly to the specified format. \\boxed{Completed}",
            reasoning: "hidden",
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: {
            content: "The response adheres strictly to the specified format. \\boxed{Completed}",
            reasoning: "hidden",
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // Gemini fallback initial passes (Gemini format — callGemini uses candidates)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: VALID_DAILY_RESPONSE, thought: false }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await generateWithLanguageGuardrails({
      roleKey: "indonesian",
      query: "これ",
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result.text).toBe(VALID_DAILY_RESPONSE);
    expect(result.source).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("language guard で daily-japanese の初回失敗は OpenRouter ReAsk で再生成する", async () => {
    // OpenRouter primary: initial fails guard, reask succeeds
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: { content: "مرحبا", reasoning: "hidden" },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{
          message: { content: VALID_DAILY_RESPONSE, reasoning: "hidden" },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await generateWithLanguageGuardrails({
      roleKey: "daily-japanese",
      query: "これ",
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result.text).toBe(VALID_DAILY_RESPONSE);
    expect(result.source).toBe("openrouter");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("language guard で OpenRouter ReAsk 2回 + Gemini ReAsk 2回 まで落ちたら LanguageGuardError を投げる", async () => {
    // OpenRouter primary: initial + 2 reasks fail
    // Gemini fallback: initial + 2 reasks also fail (Gemini format — callGemini/callLanguageModel uses candidates)
    const fetchMock = vi.fn()
      // OpenRouter initial (fails guard)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا", reasoning: "hidden" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // OpenRouter reask 1 (fails)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا مرة أخرى", reasoning: "hidden" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // OpenRouter reask 2 (fails)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا ثالث", reasoning: "hidden" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // Gemini fallback initial (fails guard) — Gemini format
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "مرحبا من fallback", thought: false }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // Gemini reask 1 (fails)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "مرحبا من reask", thought: false }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // Gemini reask 2 (fails)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "مرحبا من reask 2", thought: false }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(generateWithLanguageGuardrails({
      roleKey: "daily-japanese",
      query: "これ",
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    })).rejects.toBeInstanceOf(LanguageGuardError);

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("OpenRouter は language guard で ReAsk 2回する（primary）", async () => {
    // OpenRouter primary: initial fails guard, reask 1 fails, reask 2 succeeds
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا", reasoning: "hidden" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا مرة أخرى", reasoning: "hidden" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: VALID_DAILY_RESPONSE, reasoning: "hidden" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await generateWithLanguageGuardrails({
      roleKey: "daily-japanese",
      query: "これ",
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    });

    expect(result.text).toBe(VALID_DAILY_RESPONSE);
    expect(result.source).toBe("openrouter");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("OpenRouter の 500 エラーは即失敗し、リトライしない（primary → Gemini fallback も 500）", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("OpenRouter failed", { status: 500 }))
      .mockResolvedValueOnce(new Response("Gemini failed", { status: 500 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(generate({
      roleKey: "indonesian",
      query: "これ",
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    })).rejects.toThrow(/Gemini error: 500/i);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
