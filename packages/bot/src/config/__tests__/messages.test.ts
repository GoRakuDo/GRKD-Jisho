import { describe, expect, it } from "vitest";
import { getMessage, loadMessages, messageEntrySchema, renderMessage } from "../messages.js";

describe("messages.json", () => {
  it("zod 検証を通して読み込み、各エントリが title/description/image を持つ", () => {
    const messages = loadMessages();

    expect(Object.keys(messages).length).toBeGreaterThan(0);
    for (const [key, entry] of Object.entries(messages)) {
      expect(messageEntrySchema.safeParse(entry).success, key).toBe(true);
      // 画像添付は将来対応。現時点では全件 null の土台のみ。
      expect(entry.image, key).toBeNull();
    }

    expect(getMessage("notFound").title).toBe("Kata Tidak Ditemukan");
    expect(getMessage("wipeGuide").description).toContain("Kanal ini telah dibersihkan secara otomatis.");

    // スキーマ違反（title/description/image 欠落）は起動時に検知する
    expect(() => loadMessages('{"broken":{}}')).toThrow();
  });

  it("{{var}} プレースホルダを置換し、未指定は原文のまま残す", () => {
    expect(renderMessage("notFound", { query: "可憐" })).toBe(
      '"可憐" tidak ditemukan dalam data kamus saat ini.\nSilakan coba dengan kata lain, atau periksa kembali ejaan kata yang dimasukkan.',
    );
    expect(renderMessage("wipeSuccess", { count: 12, channel: "ch-1" })).toBe(
      "Berhasil menghapus 12 pesan di channel <#ch-1>.",
    );
    expect(renderMessage("notFound")).toContain("{{query}}");
    expect(() => renderMessage("unknownKey")).toThrow();
  });
});