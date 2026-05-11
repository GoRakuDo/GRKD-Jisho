import { describe, expect, it } from "vitest";
import { formatReply } from "../reply-formatter";

describe("formatReply", () => {
  it("短文はそのまま返す", () => {
    const text = "あ".repeat(100);

    const result = formatReply(text);
    const embed = result.embeds?.[0];

    expect(embed?.toJSON().description).toBe(text);
  });

  it("長文は Discord embed の制限内に切り詰める", () => {
    const text = "長".repeat(5000);

    const result = formatReply(text);
    const description = result.embeds?.[0]?.toJSON().description ?? "";

    expect(description).toContain("長長長");
    expect(description).toContain("長文のため途中で切れました");
    expect(description.length).toBeLessThanOrEqual(4096);
  });
});
