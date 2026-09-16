import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LLM_TEMPERATURE, DEFAULT_LLM_TOP_P, LLM_MODELS, loadLlmModels, type LlmModelEntry } from "../../config/llm-models";

vi.mock("../../config/env", () => ({
  env: {
    CPA_API_KEY: "test-cpa-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
  },
}));

import { generate, generateWithLanguageGuardrails, LanguageGuardError, normalizePromptTemplate } from "../llm.service";

const VALID_DAILY_RESPONSE = "意味:\n「これ」は、話している人と聞いている人の近くにある物や、今まさに話題にしている内容を指す言葉です。たとえば机の上の本を指して『これは本です』と言えば、その本を中心に説明しています。物だけでなく、直前に出た話題や状況をまとめて指すときにも使います。短い語ですが、会話の焦点を相手に見せる大事な役割があります。文脈の中で何を指しているかを確認すると、自然に理解できます。前の発言全体をまとめて受けることもあり、『これが問題です』のように状況そのものを指す場合もあります。指している対象が近くの物なのか、話題なのかを見分けると、意味がかなり取りやすくなります。";

beforeEach(() => {
  process.env.CPA_API_KEY = "test-cpa-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadLlmModels", () => {
  it("priority 昇順にソートされ、デフォルト timeoutMs と maxAttempts が適用される", () => {
    const rawJson = JSON.stringify({
      models: [
        { id: "model-c", priority: 2, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY" },
        { id: "model-a", priority: 0, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY" },
        { id: "model-b", priority: 1, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY", timeoutMs: 30000, maxAttempts: 3, reasoningEffort: "high" },
      ],
    });

    const models = loadLlmModels(rawJson);
    expect(models).toHaveLength(3);
    expect(models[0]?.id).toBe("model-a");
    expect(models[0]?.priority).toBe(0);
    expect(models[0]?.timeoutMs).toBe(150_000);
    expect(models[0]?.maxAttempts).toBe(2);
    expect(models[0]?.temperature).toBeUndefined();
    expect(models[0]?.topP).toBeUndefined();
    expect(models[0]?.guardReaskMax).toBe(2);
    expect(models[0]?.reasoningEffort).toBeUndefined();

    expect(models[1]?.id).toBe("model-b");
    expect(models[1]?.priority).toBe(1);
    expect(models[1]?.timeoutMs).toBe(30000);
    expect(models[1]?.maxAttempts).toBe(3);
    expect(models[1]?.reasoningEffort).toBe("high");

    expect(models[2]?.id).toBe("model-c");
    expect(models[2]?.priority).toBe(2);
  });

  it("実運用の5モデルは指定順かつ各1 attemptで読み込まれる", () => {
    expect(LLM_MODELS.map((model) => model.id)).toEqual([
      "openreouter-grkd-jisho-gemma-4-31b-it",
      "google1-grkd-jisho-gemma-4-31b-it",
      "google1-grkd-jisho-gemini-3.1-flash-lite",
      "google1-grkd-jisho-gemini-3.5-flash-lite",
      "google-grkd-jisho-gemini-flash-lite",
    ]);
    expect(LLM_MODELS.every((model) => model.maxAttempts === 1)).toBe(true);
  });
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: `【これ】\n${VALID_DAILY_RESPONSE}`,
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
    expect(result.source).toBe("openreouter-grkd-jisho-gemma-4-31b-it");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    const headers = firstCall[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-cpa-key");
  });

  it("OpenAI 互換 body 形式でリクエストを送り、reasoningEffort を reasoning_effort として送る（legacy reasoning は含めない）", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: `【これ】\n${VALID_DAILY_RESPONSE}`,
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
    expect(result.source).toBe("openreouter-grkd-jisho-gemma-4-31b-it");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    const requestBody = JSON.parse(firstCall[1]?.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      top_p?: number;
      reasoning_effort?: "low" | "medium" | "high";
      reasoning?: unknown;
    };

    expect(requestBody.model).toBe("openreouter-grkd-jisho-gemma-4-31b-it");
    expect(requestBody.messages[0]?.role).toBe("user");
    expect(requestBody.messages[0]?.content).toContain("Q=これ / これ");
    expect(requestBody.messages[0]?.content).toContain("R=これ");
    expect(requestBody.messages[0]?.content).toContain("BUCKET=daily-japanese");
    expect(requestBody.messages[0]?.content).toContain("DICT=test dictionary");
    expect(requestBody.messages[0]?.content).toContain("VER=v9");
    expect(requestBody.temperature).toBe(DEFAULT_LLM_TEMPERATURE);
    expect(requestBody.top_p).toBe(DEFAULT_LLM_TOP_P);
    expect(requestBody.reasoning_effort).toBe("high");
    expect(requestBody.reasoning).toBeUndefined();
  });

  it("reasoningEffort 未設定のモデルでは reasoning_effort をリクエストに含めない", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: `【これ】\n${VALID_DAILY_RESPONSE}`,
          },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    vi.stubGlobal("fetch", fetchMock);

    const customModels: LlmModelEntry[] = [
      { id: "no-reasoning-model", priority: 0, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY", timeoutMs: 5000, maxAttempts: 1 },
    ];

    const result = await generate({
      roleKey: "indonesian",
      query: "これ",
      dictionaryForm: "これ",
      reading: "これ",
      dictionaryName: "test dictionary",
      definitionJson: JSON.stringify({ meanings: ["near the listener"] }),
      promptTemplate: "SYSTEM\nHELLO={{query}}\n{{prompt_version}}",
      promptVersion: "v9",
    }, customModels);

    expect(result.text).toBe(`【これ】\n${VALID_DAILY_RESPONSE}`);
    expect(result.source).toBe("no-reasoning-model");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    const requestBody = JSON.parse(firstCall[1]?.body as string) as { reasoning_effort?: unknown };
    expect(requestBody.reasoning_effort).toBeUndefined();
  });

  it("JSON parse failure は同一モデルで maxAttempts 回リトライする", async () => {
    const retryModels: LlmModelEntry[] = [
      { id: "retry-model", priority: 0, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY", timeoutMs: 5000, maxAttempts: 2 },
    ];
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
    }, retryModels);

    expect(result.text).toBe(`【これ】\n${VALID_DAILY_RESPONSE}`);
    expect(result.source).toBe("retry-model");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("priority 0 モデルが失敗したら priority 1 モデルにフォールバックする", async () => {
    const fetchMock = vi.fn()
      // openreouter-grkd-jisho-gemma-4-31b-it (priority 0) fails 500
      .mockResolvedValueOnce(new Response("Model unavailable", { status: 500 }))
      // google1-grkd-jisho-gemma-4-31b-it (priority 1) succeeds
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: `【これ】\n${VALID_DAILY_RESPONSE}`,
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
    expect(result.source).toBe("google1-grkd-jisho-gemma-4-31b-it");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCall = fetchMock.mock.calls[1] as unknown as [RequestInfo | URL, RequestInit?];
    const secondBody = JSON.parse(secondCall[1]?.body as string) as { model: string };
    expect(secondBody.model).toBe("google1-grkd-jisho-gemma-4-31b-it");
  });

  it("全モデルがタイムアウトしたら全滅エラーを投げる", async () => {
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
    })).rejects.toThrow(/timed out/i);

    // 5 models * 1 attempt = 5 calls
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("generateWithLanguageGuardrails", () => {
  it("初回生成が guardrail を満たせば ReAsk なしで即座に返す", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: VALID_DAILY_RESPONSE,
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
    expect(result.source).toBe("openreouter-grkd-jisho-gemma-4-31b-it");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("output quality guard 失敗時に同一モデルで ReAsk して成功する", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: "The response adheres strictly to the specified format. \\boxed{Completed}",
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
    expect(result.source).toBe("openreouter-grkd-jisho-gemma-4-31b-it");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("guardReaskMax=0 なら ReAsk せず body 設定を反映して次のモデルへ進む", async () => {
    const customModels: LlmModelEntry[] = [
      { id: "model-1", priority: 0, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY", timeoutMs: 5000, maxAttempts: 1, temperature: 0.1, topP: 0.2, guardReaskMax: 0 },
      { id: "model-2", priority: 1, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY", timeoutMs: 5000, maxAttempts: 1, guardReaskMax: 0 },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "Quality fail 1" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: VALID_DAILY_RESPONSE } }],
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
    }, customModels);

    expect(result.source).toBe("model-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    const firstBody = JSON.parse(firstCall[1]?.body as string) as { temperature?: number; top_p?: number };
    expect(firstBody.temperature).toBe(0.1);
    expect(firstBody.top_p).toBe(0.2);
  });

  it("同一モデルで ReAsk 2回失敗したら次の priority モデルへフォールバックする", async () => {
    const fetchMock = vi.fn()
      // openreouter-grkd-jisho-gemma-4-31b-it: initial + 2 reasks all fail quality guard
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "Quality fail 1" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "Quality fail 2" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "Quality fail 3" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // google1-grkd-jisho-gemma-4-31b-it (priority 1): initial succeeds
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: VALID_DAILY_RESPONSE } }],
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
    expect(result.source).toBe("google1-grkd-jisho-gemma-4-31b-it");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("全モデルで ReAsk 含めて失敗したら LanguageGuardError を投げる", async () => {
    const customModels: LlmModelEntry[] = [
      { id: "model-1", priority: 0, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY", timeoutMs: 5000, maxAttempts: 1 },
      { id: "model-2", priority: 1, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY", timeoutMs: 5000, maxAttempts: 1 },
    ];

    const fetchMock = vi.fn()
      // model-1: initial + 2 reasks fail language guard
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا 2" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا 3" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // model-2: initial + 2 reasks fail language guard
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا 4" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا 5" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا 6" } }],
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
    }, customModels)).rejects.toBeInstanceOf(LanguageGuardError);

    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("最終モデルが transport 失敗しても先行モデルの LanguageGuardError を優先して投げる", async () => {
    const customModels: LlmModelEntry[] = [
      { id: "model-1", priority: 0, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY", timeoutMs: 5000, maxAttempts: 1 },
      { id: "model-2", priority: 1, baseUrl: "http://127.0.0.1:8317/v1", apiKeyEnv: "CPA_API_KEY", timeoutMs: 5000, maxAttempts: 1 },
    ];

    const fetchMock = vi.fn()
      // model-1: initial + 2 reasks fail language guard → lastGuardError 記録
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا 2" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "مرحبا 3" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      // model-2: transport 失敗（タイムアウト）
      .mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));

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
    }, customModels)).rejects.toBeInstanceOf(LanguageGuardError);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
