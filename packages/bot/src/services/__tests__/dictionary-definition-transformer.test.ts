import { describe, it, expect } from "vitest";
import { transformDefinitionForPrompt } from "../dictionary-definition-transformer.service.js";

describe("transformDefinitionForPrompt", () => {
  it("content: '━' を dictionaryForm に置換する", () => {
    const input = {
      tag: "span",
      data: { name: "見出相当部" },
      content: "━",
    };
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual({
      tag: "span",
      data: { name: "見出相当部" },
      content: "軟派",
    });
  });

  it("content: '―' を dictionaryForm に置換する", () => {
    const input = {
      tag: "span",
      data: { name: "見出相当部" },
      content: "―",
    };
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual({
      tag: "span",
      data: { name: "見出相当部" },
      content: "軟派",
    });
  });

  it("ネストされた content node も置換する", () => {
    const input = {
      type: "structured-content",
      content: [
        {
          tag: "span",
          data: { name: "見出相当部" },
          content: "━",
        },
        "の不良少年",
      ],
    };
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual({
      type: "structured-content",
      content: [
        {
          tag: "span",
          data: { name: "見出相当部" },
          content: "軟派",
        },
        "の不良少年",
      ],
    });
  });

  it("複数の content node を全て置換する", () => {
    const input = [
      { content: "━", tag: "span" },
      "・",
      { content: "━", tag: "span" },
    ];
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual([
      { content: "軟派", tag: "span" },
      "・",
      { content: "軟派", tag: "span" },
    ]);
  });

  it("完全一致でない文字列は置換しない（第1段階）", () => {
    const input = { content: "━の不良少年" };
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual({ content: "━の不良少年" });
  });

  it("文字列中の '―' は置換しない（広辞苑型）", () => {
    const input = { content: "①軟弱な意見の党派。「―議員」" };
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual({ content: "①軟弱な意見の党派。「―議員」" });
  });

  it("名・他サ のような品詞表記は分割しない", () => {
    const input = { content: "名・他サ" };
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual({ content: "名・他サ" });
  });

  it("dictionaryForm が空なら置換しない", () => {
    const input = { content: "━" };
    const result = transformDefinitionForPrompt(input, "");
    expect(result).toEqual({ content: "━" });
  });

  it("元オブジェクトを mutate しない", () => {
    const input = {
      tag: "span",
      data: { name: "見出相当部" },
      content: "━",
    };
    const original = JSON.parse(JSON.stringify(input));
    transformDefinitionForPrompt(input, "軟派");
    expect(input).toEqual(original);
  });

  it("content が他の文字列の時は置換しない", () => {
    const input = { content: "普通の定義文" };
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual({ content: "普通の定義文" });
  });

  it("placeholder が無い辞書は no-op で返す", () => {
    const input = [
      {
        type: "structured-content",
        content: [
          { tag: "div", content: ["①軟弱な意見の党派。「―議員」"] },
        ],
      },
    ];
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual(input);
    // no-op 時は同一参照を返す
    expect(result).toBe(input);
  });

  it("Kasou 実データ（三省堂 軟派）を変換できる", () => {
    const kasouData = [
      {
        type: "structured-content",
        content: [
          {
            tag: "span",
            data: { name: "見出部" },
            content: [{ tag: "span", data: { name: "見出相当部" }, content: "━" }],
          },
          {
            tag: "div",
            data: { name: "解説部" },
            content: [
              {
                tag: "div",
                data: { name: "語義" },
                content: [
                  { tag: "div", data: { name: "用例G" }, content: [
                    "「",
                    { tag: "span", data: { name: "用例" }, content: [
                      { tag: "span", data: { name: "見出相当部" }, content: "━" },
                      "の不良少年",
                    ]},
                    "・",
                    { tag: "span", data: { name: "用例" }, content: [
                      { tag: "span", data: { name: "見出相当部" }, content: "━" },
                      "を張る",
                    ]},
                    "」",
                  ]},
                ],
              },
            ],
          },
        ],
      },
    ];

    const result = transformDefinitionForPrompt(kasouData, "軟派");

    // 見出し語相当の2つの "━" が "軟派" に置換されている
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain('"━"');
    expect(resultJson).toContain('"軟派"');
    // "軟派" は3回現れる（見出し + 用例2つ）
    const matches = resultJson.match(/"軟派"/g);
    expect(matches?.length).toBe(3);
  });

  it("Kasou 実データ（広辞苑 軟派）は no-op", () => {
    const kobunData = [
      {
        type: "structured-content",
        content: [
          "なん‐ぱ 【軟派】",
          {
            tag: "div",
            content: [
              { tag: "div", content: ["①軟弱な意見の党派。強硬な主張をなし得ないもの。「―議員」"] },
              { tag: "div", content: ["②文芸上エロチシズムを主とするもの。「江戸―」"] },
            ],
          },
        ],
      },
    ];

    const result = transformDefinitionForPrompt(kobunData, "軟派");
    // 広辞苑は `content: "━"` が独立 node として存在しないので no-op
    expect(result).toBe(kobunData);
  });
});
