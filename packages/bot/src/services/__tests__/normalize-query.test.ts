import { describe, it, expect } from "vitest";
import { normalizeQuery } from "../normalize-query";

describe("normalizeQuery", () => {
  it("trim で前後の空白を削除する", () => {
    expect(normalizeQuery("  可憐  ")).toBe("可憐");
  });

  it("NFKC で全角英数字を半角に変換する", () => {
    expect(normalizeQuery("ＡＢＣ１２３")).toBe("ABC123");
  });

  it("NFKC で半角カタカナを全角カタカナに変換する", () => {
    expect(normalizeQuery("ｶﾀｶﾅ")).toBe("かたかな");
  });

  it("全角カタカナをひらがなに変換する", () => {
    expect(normalizeQuery("カタカナ")).toBe("かたかな");
  });

  it("混合文字列を正しく正規化する", () => {
    expect(normalizeQuery("  ｶﾀｶﾅＡＢＣ ")).toBe("かたかなABC");
  });

  it("既にひらがなの文字列は変換しない", () => {
    expect(normalizeQuery("ひらがな")).toBe("ひらがな");
  });

  it("長音符（ー）は変換しない", () => {
    expect(normalizeQuery("コーヒー")).toBe("こーひー");
  });

  it("漢字は変換しない", () => {
    expect(normalizeQuery("日本語")).toBe("日本語");
  });

  it("濁音カタカナ（ガ・ザ・ダ・バ）を正しくひらがなに変換する", () => {
    expect(normalizeQuery("ガザダバ")).toBe("がざだば");
  });

  it("半濁音カタカナ（パ）を正しくひらがなに変換する", () => {
    expect(normalizeQuery("パピプペポ")).toBe("ぱぴぷぺぽ");
  });

  it("ヴ（U+30F4）をゔ（U+3094）に正しく変換する", () => {
    expect(normalizeQuery("ヴァンパイア")).toBe("ゔぁんぱいあ");
  });

  it("空文字列は空のまま", () => {
    expect(normalizeQuery("")).toBe("");
  });
});
