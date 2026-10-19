import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import type { AppUpdater } from "electron-updater";

type UpdateBackend = Pick<AppUpdater, "checkForUpdates" | "downloadUpdate">;
type UpdateUi = {
  enabled: boolean;
  version: string;
  showMessage: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
  changed: () => void;
  requestInstall: () => void;
};

export class DesktopUpdater {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" = "idle";
  percent = 0;
  private busy = false;

  constructor(
    private backend: UpdateBackend,
    private ui: UpdateUi,
  ) {}

  get label() {
    if (this.status === "checking") return "正在检查更新…";
    if (this.status === "downloading") return `正在下载更新… ${this.percent}%`;
    if (this.status === "downloaded") return "重启并安装更新…";
    return "检查更新…";
  }

  get enabled() {
    return !this.busy;
  }

  progress(percent: number) {
    this.percent = Math.floor(percent);
    this.ui.changed();
  }

  async check(manual = true) {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.ui.enabled) {
        if (manual) await this.ui.showMessage({ message: "请安装正式发布版后检查更新" });
        return;
      }
      if (this.status !== "downloaded") {
        this.status = "checking";
        this.ui.changed();
        const result = await this.backend.checkForUpdates();
        if (!result) throw new Error("更新源未启用");
        if (!result.isUpdateAvailable) {
          this.status = "idle";
          if (manual)
            await this.ui.showMessage({ message: `当前已是最新版本（${this.ui.version}）` });
          return;
        }
        this.status = "available";
        const { response } = await this.ui.showMessage({
          message: `发现新版本 ${result.updateInfo.version}`,
          detail: `当前版本 ${this.ui.version}。下载期间可以继续工作，安装前会再次确认。`,
          buttons: ["下载更新", "稍后"],
          cancelId: 1,
        });
        if (response !== 0) return;
        this.status = "downloading";
        this.percent = 0;
        this.ui.changed();
        await this.backend.downloadUpdate();
        this.status = "downloaded";
        this.ui.changed();
      }
      const { response } = await this.ui.showMessage({
        message: "更新已下载，是否重启安装？",
        detail: "重启前会保存所有项目。正在进行的生成和 AI 对话会中断，请等任务结束后再安装。",
        buttons: ["重启并安装", "稍后"],
        defaultId: 1,
        cancelId: 1,
      });
      if (response === 0) this.ui.requestInstall();
    } catch (error) {
      console.error("[update failed]", error);
      const notify = manual || this.status !== "checking";
      this.status = "idle";
      if (notify)
        await this.ui.showMessage({
          type: "error",
          message: "更新失败，请稍后重试",
          detail: error instanceof Error ? error.message : String(error),
        });
    } finally {
      this.busy = false;
      this.ui.changed();
    }
  }
}
