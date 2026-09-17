import { describe, expect, it } from "vitest";
import {
  formatFreeModelErrorForMember,
  formatMemberPoolExhausted,
  formatReply,
  formatWipeGuide,
  WIPE_GUIDE_IMAGE_FILENAME,
} from "../reply-formatter";

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
    expect(description).toContain("Teks terlalu panjang dan terpotong");
    expect(description.length).toBeLessThanOrEqual(4096);
  });
});

describe("formatFreeModelErrorForMember", () => {
  it("メンバー向けにアップグレード誘導を含む障害文言を返す", () => {
    const result = formatFreeModelErrorForMember();

    expect(result).toContain(
      "Model gratis sedang mengalami gangguan. Coba lagi dalam 5 menit, atau upgrade membership agar bisa digunakan tanpa gangguan.",
    );
    expect(result).not.toContain("menjadi member");
    expect(result).toContain("Trakteer Kopi");
  });
});

describe("formatMemberPoolExhausted", () => {
  it("メンバー上限と共有無料枠枯渇を案内し、サポート案内を含める", () => {
    const result = formatMemberPoolExhausted(5);

    expect(result).toContain(
      "Batas harian Anda (5 kali) telah tercapai dan kuota gratis bersama juga telah habis. Upgrade membership untuk limit lebih besar, atau tunggu hingga reset pukul 00:00 GMT+7.",
    );
    expect(result).toContain("Trakteer Kopi");
  });
});

describe("formatWipeGuide", () => {
  it("タイトル・色・案内文が仕様どおり", () => {
    const result = formatWipeGuide();
    const embed = result.embeds?.[0]?.toJSON();

    expect(embed?.title).toBe("Panduan Penggunaan GRKD-Jisho");
    expect(embed?.color).toBe(0x00b7c3);
    expect(embed?.description).toContain("Kanal ini telah dibersihkan secara otomatis.");
    expect(embed?.description).toContain("@GRKD-Jisho 重ね重ね");
    expect(embed?.description).toContain("/definisi word:重ね重ね");
  });

  it("imagePath があれば attachment 画像を設定し、なければ設定しない", () => {
    const withImage = formatWipeGuide("C:/tmp/usage-guide.png");
    expect(withImage.embeds?.[0]?.toJSON().image?.url).toBe(
      `attachment://${WIPE_GUIDE_IMAGE_FILENAME}`,
    );

    const withoutImage = formatWipeGuide();
    expect(withoutImage.embeds?.[0]?.toJSON().image).toBeUndefined();
  });
});
