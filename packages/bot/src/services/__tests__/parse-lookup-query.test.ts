import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://localhost/test";
  return {};
});

import { parseLookupQuery } from "@grkd-jisho/db";

describe("parseLookupQuery", () => {
  it("漢字[よみ] を term と explicit reading に分割する", () => {
    const result = parseLookupQuery("人間[にんげん]");
    expect(result.term).toBe("人間");
    expect(result.explicitReading).toBe("にんげん");
  });

  it("全角 bracket ［］ も同じ扱い", () => {
    const result = parseLookupQuery("人間［じんかん］");
    expect(result.term).toBe("人間");
    expect(result.explicitReading).toBe("じんかん");
  });

  it("日本語 bracket 「」 も同じ扱い", () => {
    const result = parseLookupQuery("人間「にんげん」");
    expect(result.term).toBe("人間");
    expect(result.explicitReading).toBe("にんげん");
  });

  it("bracket なし → explicit reading は null、term はそのまま", () => {
    const result = parseLookupQuery("人間");
    expect(result.term).toBe("人間");
    expect(result.explicitReading).toBeNull();
  });

  it("空文字列 → explicit reading null、term は空文字", () => {
    const result = parseLookupQuery("");
    expect(result.term).toBe("");
    expect(result.explicitReading).toBeNull();
  });

  it("bracket 内が空 → 解析失敗、term は元のまま", () => {
    const result = parseLookupQuery("人間[]");
    expect(result.term).toBe("人間[]");
    expect(result.explicitReading).toBeNull();
  });

  it("bracket 内が空白のみ → 解析失敗", () => {
    const result = parseLookupQuery("人間[  ]");
    expect(result.term).toBe("人間[  ]");
    expect(result.explicitReading).toBeNull();
  });

  it("bracket が mismatch している → 解析失敗", () => {
    const result = parseLookupQuery("人間[あい");
    expect(result.term).toBe("人間[あい");
    expect(result.explicitReading).toBeNull();
  });

  it("長文の最後に [...] がある場合は term は bracket までの全 prefix", () => {
    // 日本語は whitespace で分かち書きされないので、
    // 「bracket 直前の単語」だけを term として切り出すのは KISS の範囲外。
    // 入力全体 ^\S+?\s*[\[［]\s*\S+?\s*[\]］]\s*$ 形式にマッチするため
    // term は prefix 全体になる。
    const result = parseLookupQuery("今日はいい天気ですね人間[にんげん]");
    expect(result.term).toBe("今日はいい天気ですね人間");
    expect(result.explicitReading).toBe("にんげん");
  });

  it("bracket の前後に余計なテキストがある場合はフォールバック", () => {
    const result = parseLookupQuery("今日は人間[にんげん]ですね");
    expect(result.term).toBe("今日は人間[にんげん]ですね");
    expect(result.explicitReading).toBeNull();
  });

  it("bracket 内の空白は trim される", () => {
    const result = parseLookupQuery("食べる[  たべる  ]");
    expect(result.term).toBe("食べる");
    expect(result.explicitReading).toBe("たべる");
  });

  it("【...】 は prompt heading 用なので解析対象外", () => {
    const result = parseLookupQuery("人間【じんかん】");
    expect(result.explicitReading).toBeNull();
    expect(result.term).toBe("人間【じんかん】");
  });

  it("直前の bracket pair が [...])( のように不一致なら解析失敗", () => {
    const result = parseLookupQuery("人間[あい)");
    expect(result.explicitReading).toBeNull();
    expect(result.term).toBe("人間[あい)");
  });
});
