import assert from "node:assert/strict";
import { test } from "node:test";
import type { MessageBoxOptions } from "electron";
import { DesktopUpdater } from "./updater";

function fixture(answers: number[] = []) {
  const prompts: MessageBoxOptions[] = [];
  const calls: string[] = [];
  const backend = {
    async checkForUpdates() {
      calls.push("check");
      const info = {
        version: "1.1.0",
        files: [],
        path: "app.zip",
        sha512: "fixture",
        releaseDate: "",
      };
      return {
        isUpdateAvailable: true,
        updateInfo: info,
        versionInfo: info,
      };
    },
    async downloadUpdate() {
      calls.push("download");
      return ["app.zip"];
    },
  };
  const ui = {
    enabled: true,
    version: "1.0.0",
    async showMessage(options: MessageBoxOptions) {
      prompts.push(options);
      return { response: answers.shift() ?? 1, checkboxChecked: false };
    },
    changed() {},
    requestInstall() {
      calls.push("install");
    },
  };
  return { updater: new DesktopUpdater(backend, ui), backend, ui, calls, prompts, answers };
}

test("download and restart require separate consent; deferred install reuses the download", async () => {
  const f = fixture([1, 0, 1, 0]);
  await f.updater.check();
  assert.deepEqual(f.calls, ["check"]);
  await f.updater.check();
  assert.deepEqual(f.calls, ["check", "check", "download"]);
  assert.equal(f.updater.label, "重启并安装更新…");
  await f.updater.check();
  assert.deepEqual(f.calls, ["check", "check", "download", "install"]);
});

test("concurrent checks cannot start a second download", async () => {
  const f = fixture([0, 1]);
  let finish = () => {};
  f.backend.downloadUpdate = () =>
    new Promise((resolve) => {
      finish = () => resolve([]);
    });
  const checking = f.updater.check();
  await new Promise((resolve) => setImmediate(resolve));
  f.updater.progress(43.8);
  assert.equal(f.updater.label, "正在下载更新… 43%");
  assert.equal(f.updater.enabled, false);
  await f.updater.check();
  assert.deepEqual(f.calls, ["check"]);
  finish();
  await checking;
  assert.equal(f.updater.enabled, true);
});

test("background network failures are quiet; manual failures are visible and retryable", async () => {
  const f = fixture();
  f.backend.checkForUpdates = async () => {
    throw new Error("offline");
  };
  await f.updater.check(false);
  assert.equal(f.prompts.length, 0);
  await f.updater.check();
  assert.equal(f.prompts[0]?.detail, "offline");
  assert.equal(f.updater.status, "idle");
  assert.equal(f.updater.enabled, true);
});

test("failed downloads do not offer installation; local builds never query the release feed", async () => {
  const f = fixture([0]);
  f.backend.downloadUpdate = async () => {
    throw new Error("checksum mismatch");
  };
  await f.updater.check(false);
  assert.equal(f.prompts.at(-1)?.detail, "checksum mismatch");
  assert.equal(f.calls.includes("install"), false);
  f.ui.enabled = false;
  await f.updater.check();
  assert.deepEqual(f.calls, ["check"]);
});

test("up-to-date checks report the current version only when requested manually", async () => {
  const f = fixture();
  const available = f.backend.checkForUpdates;
  f.backend.checkForUpdates = async () => ({ ...(await available()), isUpdateAvailable: false });
  await f.updater.check(false);
  assert.equal(f.prompts.length, 0);
  await f.updater.check();
  assert.equal(f.prompts[0]?.message, "当前已是最新版本（1.0.0）");
  assert.deepEqual(f.calls, ["check", "check"]);
  assert.equal(f.updater.status, "idle");
});
