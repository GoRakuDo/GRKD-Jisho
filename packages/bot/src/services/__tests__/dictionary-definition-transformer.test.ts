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

  it("文字列中の '―' は「」内なら辞書形に置換する（「―議員」型）", () => {
    const input = { content: "①軟弱な意見の党派。「―議員」" };
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual({ content: "①軟弱な意見の党派。「軟派議員」" });
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

  it("「」内の ━ を辞書形に置換する", () => {
    const input = { content: "「━の不良少年」" };
    const result = transformDefinitionForPrompt(input, "軟派");
    expect(result).toEqual({ content: "「軟派の不良少年」" });
  });

  it("「」内の ― を辞書形に置換する", () => {
    const input = { content: "「それがよろしいかと―・じます」" };
    const result = transformDefinitionForPrompt(input, "存ずる");
    expect(result).toEqual({ content: "「それがよろしいかと存ずる・じます」" });
  });

  it("「」外の ━ / ― は置換しない", () => {
    const input = { content: "━の不良少年・―を張る" };
    const result = transformDefinitionForPrompt(input, "軟派");
    // 「」で囲まれていないので置換されない
    expect(result).toEqual({ content: "━の不良少年・―を張る" });
  });

  it("複数の「」をまとめて置換する", () => {
    const input = { content: "①「思う」「考える」の謙譲語。「それがよろしいかと―・じます」" };
    const result = transformDefinitionForPrompt(input, "存ずる");
    expect(result).toEqual({ content: "①「思う」「考える」の謙譲語。「それがよろしいかと存ずる・じます」" });
  });

  it("Kasou 実データ（広辞苑 存ずる）を変換できる", () => {
    // 実際の Kasou DB から取得した生 JSON の構造
    const kasouData = [
      {
        type: "structured-content",
        content: [
          "ぞん・ずる 【存ずる】",
          {
            tag: "div",
            content: [
              { tag: "div", content: ["〘自サ変〙〚文〛存ず（サ変）"] },
              { tag: "div", content: ["①「思う」「考える」の謙譲語。「それがよろしいかと―・じます」"] },
              { tag: "div", content: ["②「知る」の謙譲語。「何も―・じません」"] },
            ],
          },
        ],
      },
    ];

    const result = transformDefinitionForPrompt(kasouData, "存ずる");
    const resultJson = JSON.stringify(result);
    // 「」内の ― が全て辞書形に置換されている
    expect(resultJson).not.toContain("―・じます");
    expect(resultJson).toContain("存ずる・じます");
    expect(resultJson).toContain("存ずる・じません");
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
          { tag: "div", content: ["①軟弱な意見の党派。強硬な主張をなし得ないもの。"] },
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

  it("Kasou 実データ（広辞苑 軟派）の「」内 ― を置換する", () => {
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
    // 「」内の ― が辞書形に置換されている
    expect(result).toEqual([
      {
        type: "structured-content",
        content: [
          "なん‐ぱ 【軟派】",
          {
            tag: "div",
            content: [
              { tag: "div", content: ["①軟弱な意見の党派。強硬な主張をなし得ないもの。「軟派議員」"] },
              { tag: "div", content: ["②文芸上エロチシズムを主とするもの。「江戸軟派」"] },
            ],
          },
        ],
      },
    ]);
  });
});
