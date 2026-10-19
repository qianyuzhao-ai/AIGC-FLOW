import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "unit/projects": "src/tab-model.test.ts",
    "unit/persistence": "../client/src/lib/save-queue.test.ts",
    "unit/updater": "src/updater.test.ts",
    smoke: "tests/workspace-smoke.ts",
    "update-smoke": "tests/update-smoke.ts",
    preload: "src/preload.ts",
  },
  outDir: "dist/tests",
  format: ["cjs"],
  target: "node22",
  clean: false,
  external: ["electron", "electron-updater"],
  removeNodeProtocol: false,
  outExtension: () => ({ js: ".cjs" }),
});
