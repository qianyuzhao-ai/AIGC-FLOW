import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu } from "electron";
import { autoSaveDownloads } from "./downloads";
import { listenWithFallback } from "./listen";
import { initLog } from "./log";
import { createProjectWindow } from "./project-view";
import { migrationsFolder, webRoot } from "./resources";
import { createShell } from "./shell";
import { protectWindowClose } from "./tab-close";
import { installDesktopWindowApi } from "./tabs";
import { createUpdateService } from "./update-service";

/**
 * 桌面端固定端口。
 *
 * 不能用 port: 0 随机分配 —— localStorage 按 origin 隔离而 origin 含端口，
 * 随机端口意味着每次启动画布剪贴板都清空，直接违背「切项目、刷新之后都还粘得出来」的契约。
 * 39501 落在 30000-45000：避开 3000/3001/8080 这些开发端口，也避开 Windows 临时端口段（49152+）。
 */
const BASE_PORT = 39501;

// 同一台机器只允许一个实例：既避免两个进程开同一个 SQLite 文件，也避免自己和自己抢端口
if (!app.requestSingleInstanceLock()) app.exit(0);

/**
 * ⚠️ setPath 必须在 app ready 之前同步调用。放到 whenReady 之后的话
 * Chromium 已经按旧路径初始化完缓存服务，改了 userData 会一路报
 * 「Failed to create directory: .../Shared Dictionary/cache」「Unable to create cache」。
 * 顺带定死目录名，否则 dev 下会落到 "Electron"。
 */
app.setPath(
  "userData",
  join(app.getPath("appData"), app.isPackaged ? "AIGC-FLOW" : "AIGC-FLOW-dev"),
);
const USER_DATA = app.getPath("userData");
const LOG_FILE = initLog(USER_DATA);

// Windows 上不设这个，系统通知不会带应用身份、也可能根本不弹
app.setAppUserModelId("com.aigcflow.desktop");

let mainWindow: BrowserWindow | null = null;
let quitRequested = false;
let updateRequested = false;
let updates: ReturnType<typeof createUpdateService> | undefined;
/** 退出时要收尾的两样东西，will-quit 里用 */
let teardown: { closeServer: (done: () => void) => void; closeDb: () => void } | null = null;

/**
 * 启动内嵌的 Hono server。
 *
 * ⚠️ 这里的 import 必须是动态的。apps/server 的 db/index.ts 在模块加载时就
 * `new Database(resolve(process.cwd(), env.DATABASE_URL))`，而静态 import 的模块求值
 * 先于宿主模块的任何语句，DATABASE_URL 还没赋值库就已经开在错误的位置了。
 * 动态 import 被 esbuild 编译成 Promise.resolve().then(() => (init_db(), db_exports))，惰性保持。
 *
 * 同理别改成「先 import 一个设置环境变量的副作用模块」：biome 开了 organizeImports，
 * 一次 lint:fix 就会按字母序把两行调换，而且这个 bug 只在打包后才表现出来。
 */
async function bootServer(): Promise<number> {
  console.log(`📁 userData ${USER_DATA}`);
  console.log(`📝 log      ${LOG_FILE}`);

  process.env.NODE_ENV = "production";
  // resolve() 对绝对路径是幂等的，所以给绝对路径就能改库位置，server 代码一行不用动
  process.env.DATABASE_URL = join(USER_DATA, "data", "aigc-flow.db");
  // 端口要等 listen 成功才知道，这里把候选端口全列上（同源请求根本不带 Origin 头，
  // 这份白名单实际用不上，纯粹是别让它成为一个错误的配置）
  process.env.CORS_ORIGIN = Array.from(
    { length: 5 },
    (_, i) => `http://127.0.0.1:${BASE_PORT + i}`,
  ).join(",");

  const { db, dbPath } = await import("@aigc-flow/server/db");
  console.log(`🗄  sqlite   ${dbPath}`);

  // 迁移必须跑在路由之前：migrate 是同步的，跑完再 listen，
  // 天然不存在「迁移还没完请求就进来」的窗口
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const folder = migrationsFolder();
  try {
    migrate(db, { migrationsFolder: folder });
    console.log(`✅ migrate  ${folder}`);
  } catch (err) {
    // 打包后没人看得到 stdout，数据库没建起来又什么都干不了，只能弹框后退出
    console.error("[migrate failed]", err);
    dialog.showErrorBox(
      "数据库初始化失败",
      `迁移目录：${folder}\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    app.exit(1);
  }

  const { app: honoApp } = await import("@aigc-flow/server/app");
  const web = webRoot();
  console.log(`🌐 web      ${web}`);

  const { server, port, fellBack } = await listenWithFallback(
    createShell(honoApp, web),
    BASE_PORT,
    () => {
      dialog.showErrorBox(
        "AIGC-FLOW 已经在运行",
        `端口 ${BASE_PORT} 上已经有一个 AIGC-FLOW 在跑。\n请切换到那个窗口，不要同时开两个。`,
      );
      app.exit(0);
    },
  );
  console.log(`🚀 server   http://127.0.0.1:${port}`);

  if (fellBack) {
    // 换了端口就换了 origin，localStorage 跟着换隔离域。静默降级比报错更糟，
    // 用户会以为剪贴板坏了，所以这里必须明说。
    //
    // ⚠️ 必须用异步的 showMessageBox：Sync 版会阻塞主进程线程，而 HTTP server
    // 就跑在这个线程上，弹窗没人点的这段时间里所有请求都卡死（实测 curl 直接超时）。
    void dialog.showMessageBox({
      type: "warning",
      message: `端口 ${BASE_PORT} 被占用，本次使用 ${port}`,
      detail: "画布剪贴板（⌘C / ⌘V 的内容）会从空的开始。关掉占用该端口的程序后重启即可恢复。",
      buttons: ["知道了"],
    });
  }

  // Node 默认 300s 的 requestTimeout 是「收完整个请求」的上限，20×200MB 的 multipart 别赌。
  // 注意它不管「回响应」，所以 10-30 分钟的 /api/generate 本来就不受影响。
  // serve() 的返回类型是 http.Server | Http2Server 的联合，后者没有这两个属性
  // （同 apps/server/src/index.ts 里 closeAllConnections 那处的收窄写法）
  if ("requestTimeout" in server) {
    server.requestTimeout = 0;
    server.headersTimeout = 0;
  }

  teardown = {
    closeServer: (done: () => void) => {
      // 必须先掐断 keep-alive 连接：只调 close() 的话它会一直等连接排空，
      // 而画布常年挂着长连接，回调永远不来（apps/server/src/index.ts 踩过这个坑）
      if ("closeAllConnections" in server) server.closeAllConnections();
      server.close(() => done());
    },
    closeDb: () => {
      // 把 -wal 合回主库再清零，免得 userData 里留一堆附属文件让用户困惑
      db.$client.pragma("wal_checkpoint(TRUNCATE)");
      db.$client.close();
    },
  };

  return port;
}

function createWindow(port: number) {
  const win = createProjectWindow();
  installDesktopWindowApi(win);
  protectWindowClose(win, () => {
    quitRequested = false;
    updateRequested = false;
  });
  win.on("closed", () => {
    mainWindow = null;
    if (updateRequested) {
      updateRequested = false;
      updates?.install();
    } else if (quitRequested) app.quit();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== `http://127.0.0.1:${port}`) event.preventDefault();
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
  return win;
}

app.on("before-quit", (event) => {
  if (!mainWindow) return;
  event.preventDefault();
  quitRequested = true;
  mainWindow.close();
});

app
  .whenReady()
  .then(async () => {
    const port = await bootServer();
    // 必须在 app ready 之后：defaultSession 这时才存在
    autoSaveDownloads();
    mainWindow = createWindow(port);
    updates = createUpdateService(
      () => mainWindow,
      () => {
        if (updateRequested || updates?.installing) return;
        quitRequested = false;
        if (mainWindow) {
          updateRequested = true;
          mainWindow.close();
        } else updates?.install();
      },
      () => {
        if (!mainWindow) mainWindow = createWindow(port);
      },
    );
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [
              {
                label: app.name,
                submenu: [
                  { role: "about" as const },
                  updates.menuItem,
                  { type: "separator" as const },
                  { role: "services" as const },
                  { type: "separator" as const },
                  { role: "hide" as const },
                  { role: "hideOthers" as const },
                  { role: "unhide" as const },
                  { type: "separator" as const },
                  { role: "quit" as const },
                ],
              },
            ]
          : []),
        {
          label: "文件",
          submenu: [
            {
              label: "关闭项目标签",
              accelerator: "CmdOrCtrl+W",
              click: () => mainWindow?.webContents.send("desktop:tab-shortcut", "close"),
            },
            { role: "quit" },
          ],
        },
        { role: "editMenu" },
        { label: "视图", submenu: [{ role: "toggleDevTools" }, { role: "togglefullscreen" }] },
        { role: "windowMenu" },
        ...(process.platform === "darwin" ? [] : [{ label: "帮助", submenu: [updates.menuItem] }]),
      ]),
    );

    // macOS 的惯例：图标还在 dock 上时点一下要能把窗口叫回来
    app.on("activate", () => {
      if (!updates?.installing && BrowserWindow.getAllWindows().length === 0)
        mainWindow = createWindow(port);
    });
  })
  .catch((err) => {
    console.error("[boot failed]", err);
    dialog.showErrorBox("启动失败", err instanceof Error ? err.message : String(err));
    app.exit(1);
  });

// 第二次启动被单实例锁挡下时，把已有窗口叫到前面来，别让用户以为没反应
app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// mac 上关掉窗口不退出应用是惯例；win/linux 关窗即退出
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitting = false;
app.on("will-quit", (event) => {
  if (quitting || !teardown) return;
  quitting = true;
  event.preventDefault();

  const { closeServer, closeDb } = teardown;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    try {
      closeDb();
    } catch (err) {
      console.error("[db close failed]", err);
    }
    app.exit(0);
  };

  // 挂着 30 分钟的 /api/generate 时 close 的回调可能一直不来，给个兜底。
  // 强杀也不会丢已提交的写入（better-sqlite3 是同步 API），最坏只是留个 -wal。
  const bail = setTimeout(finish, 1500);
  bail.unref();

  try {
    closeServer(() => {
      clearTimeout(bail);
      finish();
    });
  } catch (err) {
    console.error("[server close failed]", err);
    clearTimeout(bail);
    finish();
  }
});
