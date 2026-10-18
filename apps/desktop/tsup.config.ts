import { defineConfig } from "tsup";

/**
 * 必须留在 bundle 外面的运行时依赖：
 * - electron：由运行时提供
 * - better-sqlite3：lib/binding.js 用 __dirname 拼 prebuilds 下的 .node 再 require，
 *   内联进 bundle 后 __dirname 变成 dist/，加载必死
 * - Pi SDK：保留 ESM 模块和随包提供的资源，通过动态 import 加载
 *
 * ⚠️ 光写 external 不够：tsup 的 noExternal 优先级高于 external，
 * 一个「匹配一切」的 noExternal 会把它们又拽回来（实测 better-sqlite3 被内联，
 * 产物里出现了 getPrebuildPath）。所以 noExternal 必须用负向断言排除外部依赖。
 */
const EXTERNAL = ["electron", "better-sqlite3", "@earendil-works/pi-coding-agent"];

export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts"],
  // CJS：better-sqlite3 是 CJS，且 Electron 的 asar 钩子接的是 require()
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  outExtension: () => ({ js: ".cjs" }),
  clean: false,
  sourcemap: true,
  external: EXTERNAL,
  // tsup 默认把 package.json 的 dependencies 全部 external，不覆盖掉的话产物就是个空壳
  // （apps/server/tsup.config.ts 就是这个毛病，产物只有 13KB）
  noExternal: [new RegExp(`^(?!(${EXTERNAL.join("|")})$).*`)],
});
