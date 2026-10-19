import { randomUUID } from "node:crypto";
import { type BrowserWindow, dialog, ipcMain } from "electron";

/** Save every resident project before the native window is allowed to close. */
export function protectWindowClose(window: BrowserWindow, cancelled = () => {}) {
  let approved = false;
  let waiting = false;
  let pending: { token: string; finish: (saved: boolean) => void } | undefined;
  const receive = (event: Electron.IpcMainEvent, token: unknown, saved: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      return;
    if (pending && pending.token === token) pending.finish(saved === true);
  };
  ipcMain.on("desktop:close-response", receive);
  window.webContents.on("will-prevent-unload", (event) => {
    if (approved) event.preventDefault();
  });
  window.on("close", (event) => {
    if (approved) return;
    event.preventDefault();
    if (waiting) return;
    waiting = true;
    void (async () => {
      const saved = await new Promise<boolean>((resolve) => {
        const token = randomUUID();
        const timer = setTimeout(() => {
          if (window.isDestroyed()) return;
          void dialog
            .showMessageBox(window, {
              type: "warning",
              message: "页面未响应，无法确认所有项目均已保存",
              detail: "强制关闭可能丢失最近的更改。可以取消并等待页面恢复。",
              buttons: ["取消", "仍然关闭"],
              defaultId: 0,
              cancelId: 0,
            })
            .then(({ response }) => {
              if (pending && pending.token === token) pending.finish(response === 1);
            })
            .catch(() => {
              if (pending && pending.token === token) pending.finish(false);
            });
        }, 15_000);
        pending = {
          token,
          finish: (ok) => {
            clearTimeout(timer);
            pending = undefined;
            resolve(ok);
          },
        };
        window.webContents.send("desktop:close-request", token);
      });
      waiting = false;
      if (saved && !window.isDestroyed()) {
        approved = true;
        window.close();
      } else cancelled();
    })().catch(async () => {
      waiting = false;
      cancelled();
      if (!window.isDestroyed())
        await dialog.showMessageBox(window, {
          message: "无法完成保存，请稍后再试",
          buttons: ["知道了"],
        });
    });
  });
  window.on("closed", () => {
    pending?.finish(false);
    ipcMain.removeListener("desktop:close-response", receive);
  });
}
