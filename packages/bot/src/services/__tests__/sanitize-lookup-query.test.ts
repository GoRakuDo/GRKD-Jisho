import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://localhost/test";
  return {};
});

import { mergePopularQueries, sanitizeLookupQuery } from "@grkd-jisho/db";

describe("sanitizeLookupQuery", () => {
  it("Discord mention と装飾タグと issue 番号を落とす", () => {
    expect(
      sanitizeLookupQuery("<@1502238999832428626>【Pre-Release TEST】#7313 食べる"),
    ).toBe("食べる");
  });

  it("role mention と channel mention も落とす", () => {
    expect(
      sanitizeLookupQuery("<@&1502238999832428626> <#123456789012345678> います"),
    ).toBe("います");
  });

  it("検索語そのものは残す", () => {
    expect(sanitizeLookupQuery("食べる")).toBe("食べる");
  });

  it("空文字と空白だけは空のまま", () => {
    expect(sanitizeLookupQuery("   ")).toBe("");
  });

  it("連続 mention も落とす", () => {
    expect(sanitizeLookupQuery("<@1><@2>【Note】#7313 食べる")).toBe("食べる");
  });

  it("文中の mention も落とす", () => {
    expect(sanitizeLookupQuery("食べる <@1>")).toBe("食べる");
  });
});

describe("mergePopularQueries", () => {
  it("sanitized label ごとに count をまとめる", () => {
    expect(
      mergePopularQueries(
        [
          { query: "<@1>食べる", count: 2 },
          { query: "【TEST】#7313 食べる", count: 3 },
          { query: "友情", count: 1 },
        ],
        20,
      ),
    ).toEqual([
      { query: "食べる", count: 5 },
      { query: "友情", count: 1 },
    ]);
  });

  it("空になった行は捨てる", () => {
    expect(
      mergePopularQueries([{ query: "<@1>【TEST】#7313", count: 1 }], 20),
    ).toEqual([]);
  });

  it("bigint count も扱える", () => {
    expect(
      mergePopularQueries([{ query: "食べる", count: BigInt(7) }], 20),
    ).toEqual([{ query: "食べる", count: 7 }]);
  });
});
