import { describe, expect, it } from "vitest";
import { shouldReprocessEditedMention } from "../message-update.service";

function createMessage(content: string, mentioned: boolean, partial = false) {
  return {
    content,
    partial,
    mentions: {
      has: () => mentioned,
    },
  };
}

describe("shouldReprocessEditedMention", () => {
  it("mention が後付けされた編集だけ true を返す", () => {
    expect(
      shouldReprocessEditedMention(
        createMessage("単語", false),
        createMessage("@grkd-jisho 単語", true),
        "bot-id",
      ),
    ).toBe(true);
  });

  it("既に mention があるメッセージは false を返す", () => {
    expect(
      shouldReprocessEditedMention(
        createMessage("@grkd-jisho 単語", true),
        createMessage("@grkd-jisho 単語です", true),
        "bot-id",
      ),
    ).toBe(false);
  });

  it("oldMessage / newMessage が partial なら安全側に倒して false を返す", () => {
    expect(
      shouldReprocessEditedMention(
        createMessage("単語", false, true),
        createMessage("@grkd-jisho 単語", true),
        "bot-id",
      ),
    ).toBe(false);
  });
});
