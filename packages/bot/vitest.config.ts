import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // source ファイルと同じディレクトリに *.test.ts を置く
    include: ["src/**/*.test.ts"],
    // vitest に TypeScript トランスパイルを任せる（tsx 不要）
    pool: "forks",
  },
});
