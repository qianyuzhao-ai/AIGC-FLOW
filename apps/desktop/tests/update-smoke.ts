import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu } from "electron";
import { autoUpdater } from "electron-updater";
import { protectWindowClose } from "../src/tab-close";
import { createUpdateService } from "../src/update-service";

const isolated = mkdtempSync(join(tmpdir(), "aigc-update-smoke-"));
app.setPath("userData", isolated);
Object.defineProperty(app, "isPackaged", { value: true });
Object.defineProperty(process, "resourcesPath", { value: isolated });
writeFileSync(join(isolated, "app-update.yml"), "provider: github\n");
app.on("window-all-closed", () => {});
const prompts: string[] = [];
dialog.showMessageBox = (async (...args: unknown[]) => {
  const options = args.at(-1) as Electron.MessageBoxOptions;
  prompts.push(options.message);
  return { response: 0, checkboxChecked: false };
}) as typeof dialog.showMessageBox;
const info = { version: "99.0.0", files: [], path: "app.zip", sha512: "fixture", releaseDate: "" };
autoUpdater.checkForUpdates = async () => ({
  isUpdateAvailable: true,
  updateInfo: info,
  versionInfo: info,
});
let downloads = 0;
autoUpdater.downloadUpdate = async () => {
  downloads++;
  return ["app.zip"];
};

async function waitUntil(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for update state");
}

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { preload: join(__dirname, "preload.cjs") },
    });
    let cancelled = false;
    let requested = false;
    let installed = false;
    let restored = false;
    protectWindowClose(window, () => {
      cancelled = true;
      requested = false;
    });
    const service = createUpdateService(
      () => (window.isDestroyed() ? null : window),
      () => {
        requested = true;
        window.close();
      },
      () => {
        restored = true;
      },
    );
    window.on("closed", () => {
      if (requested) service.install();
    });
    autoUpdater.quitAndInstall = () => {
      assert.equal(
        window.isDestroyed(),
        true,
        "the installer must wait for saved projects and closed windows",
      );
      installed = true;
    };
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: "AIGC-FLOW", submenu: [service.menuItem] }]),
    );
    const item = Menu.getApplicationMenu()?.getMenuItemById("check-for-updates");
    assert.ok(item);
    assert.equal(autoUpdater.autoInstallOnAppQuit, false);
    assert.equal(autoUpdater.autoDownload, false);
    assert.equal(autoUpdater.allowPrerelease, false);
    await window.loadURL("data:text/html,<h1>Update test</h1>");
    await window.webContents.executeJavaScript(
      "window.canSave = false; window.desktop.beforeWindowClose(() => window.canSave); true",
    );
    item.click();
    await waitUntil(() => cancelled);
    assert.equal(installed, false);
    assert.equal(window.isDestroyed(), false);
    await window.webContents.executeJavaScript("window.canSave = true");
    item.click();
    await waitUntil(() => installed);
    assert.equal(downloads, 1);
    assert.equal(service.installing, true);
    assert.equal(item.enabled, false);
    autoUpdater.emit("error", new Error("simulated signature rejection"), "");
    assert.equal(restored, true);
    assert.equal(service.installing, false);
    assert.equal(item.enabled, true);
    assert.ok(prompts.includes("无法安装更新"));
    console.log(
      "PASS native menu, save cancellation, retry without download, install ordering and error recovery",
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
