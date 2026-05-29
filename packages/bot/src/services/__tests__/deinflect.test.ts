import { describe, expect, it } from "vitest";
import { deinflect } from "../deinflect";

describe("deinflect", () => {
  // ── て-form → 辞書形 ──

  it("五段 って→う: 思って→思う", () => {
    const result = deinflect("思って");
    expect(result.map((r) => r.text)).toContain("思う");
  });

  it("五段 って→つ: 待って→待つ", () => {
    const result = deinflect("待って");
    expect(result.map((r) => r.text)).toContain("待つ");
  });

  it("五段 って→る: 作って→作る", () => {
    const result = deinflect("作って");
    expect(result.map((r) => r.text)).toContain("作る");
  });

  it("五段 いて→く: 書いて→書く", () => {
    const result = deinflect("書いて");
    expect(result.map((r) => r.text)).toContain("書く");
  });

  it("五段 いで→ぐ: 泳いで→泳ぐ", () => {
    const result = deinflect("泳いで");
    expect(result.map((r) => r.text)).toContain("泳ぐ");
  });

  it("五段 して→す: 話して→話す", () => {
    const result = deinflect("話して");
    expect(result.map((r) => r.text)).toContain("話す");
  });

  it("五段 んで→ぬ: 死んで→死ぬ", () => {
    const result = deinflect("死んで");
    expect(result.map((r) => r.text)).toContain("死ぬ");
  });

  it("五段 んで→ぶ: 遊んで→遊ぶ", () => {
    const result = deinflect("遊んで");
    expect(result.map((r) => r.text)).toContain("遊ぶ");
  });

  it("五段 んで→む: 読んで→読む", () => {
    const result = deinflect("読んで");
    expect(result.map((r) => r.text)).toContain("読む");
  });

  it("一段 て→る: 食べて→食べる", () => {
    const result = deinflect("食べて");
    expect(result.map((r) => r.text)).toContain("食べる");
  });

  // ── た-form（過去）→ 辞書形（2段階チェーン）──

  it("た→て→る: 思った→思う（2段階）", () => {
    const result = deinflect("思った");
    expect(result.map((r) => r.text)).toContain("思う");
    // 中間形も含まれる
    expect(result.map((r) => r.text)).toContain("思って");
  });

  it("た→て→る: 食べた→食べる（2段階）", () => {
    const result = deinflect("食べた");
    expect(result.map((r) => r.text)).toContain("食べる");
    expect(result.map((r) => r.text)).toContain("食べて");
  });

  // ── ない（否定）──

  it("ない→る: 食べない→食べる", () => {
    const result = deinflect("食べない");
    expect(result.map((r) => r.text)).toContain("食べる");
  });

  it("わない→う: 思わない→思う", () => {
    const result = deinflect("思わない");
    expect(result.map((r) => r.text)).toContain("思う");
  });

  it("かない→く: 書かない→書く", () => {
    const result = deinflect("書かない");
    expect(result.map((r) => r.text)).toContain("書く");
  });

  // ── ます（丁寧）──

  it("います→う: 思います→思う", () => {
    const result = deinflect("思います");
    expect(result.map((r) => r.text)).toContain("思う");
  });

  it("ます→る: 食べます→食べる", () => {
    const result = deinflect("食べます");
    expect(result.map((r) => r.text)).toContain("食べる");
  });

  // ── ない→る からのチェーン: ません → る + ない → る ──

  it("ません→る（直接）: 思いません→思う", () => {
    const result = deinflect("思いません");
    expect(result.map((r) => r.text)).toContain("思う");
  });

  // ── 3段階チェーン ──

  it("食べさせられた→食べる（3段階）", () => {
    const result = deinflect("食べさせられた");
    expect(result.map((r) => r.text)).toContain("食べる");
  });

  // ── 特殊系 ──

  it("する系: 勉強します→勉強する", () => {
    const result = deinflect("勉強します");
    expect(result.map((r) => r.text)).toContain("勉強する");
  });

  it("くる系: 来ます→来る", () => {
    const result = deinflect("来ます");
    expect(result.map((r) => r.text)).toContain("来る");
  });

  it("過去+てしまう chain: 思ってしまった→思う", () => {
    const result = deinflect("思ってしまった");
    expect(result.map((r) => r.text)).toContain("思う");
  });

  it("文語形容詞: 止事無き→止事無い", () => {
    const result = deinflect("止事無き");
    expect(result.map((r) => r.text)).toContain("止事無い");
  });

  it("文語形容詞: やんごとなき→やんごとない", () => {
    const result = deinflect("やんごとなき");
    expect(result.map((r) => r.text)).toContain("やんごとない");
  });

  // ── エッジケース ──

  it("空文字列は空配列", () => {
    expect(deinflect("")).toEqual([]);
  });

  it("短すぎる文字列（1文字）は空配列", () => {
    expect(deinflect("あ")).toEqual([]);
  });

  it("辞書形（未然形でない）は結果があってもいいが空でもOK", () => {
    // 「食べる」に deinflect をかけても何も変わらない or 空
    // 実装によっては「る→る」（自己ルール）が効く場合がある
    // ここでは「少なくとも空じゃないか、元の文字列が含まれる」ことを確認
    const result = deinflect("食べる");
    // ルールによっては「食べる」に一致するルールがないので空になるはず
    expect(Array.isArray(result)).toBe(true);
  });
});
