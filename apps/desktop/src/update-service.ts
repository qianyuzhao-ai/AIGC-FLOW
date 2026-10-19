import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow, dialog, Menu, type MenuItemConstructorOptions } from "electron";
import { autoUpdater } from "electron-updater";
import { DesktopUpdater } from "./updater";

export function createUpdateService(
  getWindow: () => BrowserWindow | null,
  requestInstall: () => void,
  restoreWindow: () => void,
) {
  const enabled = app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"));
  let installing = false;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = {
    info: (...args) => console.log("[updater]", ...args),
    warn: (...args) => console.warn("[updater]", ...args),
    error: (...args) => console.error("[updater]", ...args),
  };
  const controller = new DesktopUpdater(autoUpdater, {
    enabled,
    version: app.getVersion(),
    showMessage: (options) => {
      const window = getWindow();
      const prompt = { title: "AIGC-FLOW 更新", buttons: ["知道了"], ...options };
      return window ? dialog.showMessageBox(window, prompt) : dialog.showMessageBox(prompt);
    },
    requestInstall,
    changed: refresh,
  });
  function refresh() {
    const item = Menu.getApplicationMenu()?.getMenuItemById("check-for-updates");
    if (item) {
      item.label = installing ? "正在准备安装…" : controller.label;
      item.enabled = controller.enabled && !installing;
    }
    getWindow()?.setProgressBar(
      controller.status === "downloading" ? controller.percent / 100 : -1,
    );
  }
  autoUpdater.on("download-progress", ({ percent }) => controller.progress(percent));
  function handleError(error: Error) {
    console.error("[updater]", error);
    // Check/download errors reject their promises; native macOS staging errors arrive later.
    if (!installing) return;
    installing = false;
    restoreWindow();
    refresh();
    void dialog.showMessageBox({
      type: "error",
      message: "无法安装更新",
      detail: `${error.message}\n\n可以重新检查更新，或手动安装新版。`,
    });
  }
  autoUpdater.on("error", handleError);
  if (enabled) {
    const timer = setTimeout(() => {
      if (controller.status === "idle") void controller.check(false);
    }, 15_000);
    timer.unref();
    app.once("before-quit", () => clearTimeout(timer));
  }
  const menuItem: MenuItemConstructorOptions = {
    id: "check-for-updates",
    label: controller.label,
    accelerator: "CmdOrCtrl+Shift+U",
    click: () => void controller.check(),
  };
  return {
    menuItem,
    get installing() {
      return installing;
    },
    install() {
      if (installing) return;
      installing = true;
      refresh();
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        handleError(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}
