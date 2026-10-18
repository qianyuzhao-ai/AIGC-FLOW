import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import {
  DEFAULT_IMAGE_GEN_DATA,
  DEFAULT_VIDEO_GEN_DATA,
  IMAGE_GEN_NODE_TYPE,
  type ProjectGraph,
  VIDEO_GEN_NODE_TYPE,
} from "@aigc-flow/shared";
import { app, type BrowserWindow, dialog, nativeTheme } from "electron";
import { createProjectWindow } from "../src/project-view";
import { protectWindowClose } from "../src/tab-close";
import { installDesktopWindowApi } from "../src/tabs";

const web = process.env.AIGC_TEST_WEB;
if (!web) throw new Error("AIGC_TEST_WEB must point to the desktop static export");
const artifacts = mkdtempSync(join(tmpdir(), "aigc-project-tabs-"));
app.setPath("userData", artifacts);
app.on("window-all-closed", () => {});
const names = ["双人播客制作", "品牌短片", "角色设定"];
const projects = names.map((name, index) => ({
  id: index + 1,
  name,
  coverImage: null,
  createdAt: "2026-09-30T12:00:00Z",
  updatedAt: "2026-09-30T12:00:00Z",
}));
const graphs = new Map<number, ProjectGraph>(
  projects.map((project) => [
    project.id,
    {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  ]),
);
graphs.set(3, {
  nodes: [
    {
      id: "visibility-video",
      type: VIDEO_GEN_NODE_TYPE,
      position: { x: 160, y: 180 },
      data: { ...DEFAULT_VIDEO_GEN_DATA },
    },
    {
      id: "visibility-image",
      type: IMAGE_GEN_NODE_TYPE,
      position: { x: 780, y: 180 },
      data: { ...DEFAULT_IMAGE_GEN_DATA },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
let rejectWrites = false;
let releaseGeneration: (() => void) | undefined;
const versions = new Map<number, number>();
const jobs = new Map<
  string,
  {
    id: string;
    projectId: number;
    nodeId: string;
    kind: string;
    input: unknown;
    status: string;
    resultUrl: string | null;
    error: null;
  }
>();
let generationPending = false;
const prompts: string[] = [];
const responses: number[] = [];
dialog.showMessageBox = (async (_owner: unknown, options: { message: string }) => {
  prompts.push(options.message);
  return { response: responses.shift() ?? 0, checkboxChecked: false };
}) as typeof dialog.showMessageBox;

// In-memory endpoints deliberately never use the user's DB, models, or credentials.
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://test");
  const send = (value: unknown, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (url.pathname === "/api/projects") return send(projects);
  const project = /^\/api\/projects\/(\d+)(\/graph)?$/.exec(url.pathname);
  if (project) {
    const id = Number(project[1]);
    if (request.method === "PUT") {
      let body = "";
      for await (const chunk of request) body += chunk;
      if (rejectWrites) return send({ message: "isolated save failure" }, 500);
      const parsed = JSON.parse(body);
      graphs.set(id, parsed.graph);
      versions.set(id, (versions.get(id) ?? 0) + 1);
      return send({ id, version: versions.get(id) });
    }
    if (request.method === "PATCH") {
      let body = "";
      for await (const chunk of request) body += chunk;
      await new Promise((done) => setTimeout(done, 250));
      Object.assign(projects.find((item) => item.id === id) ?? {}, JSON.parse(body));
    }
    return send(
      project[2]
        ? { graph: graphs.get(id), version: versions.get(id) ?? 0 }
        : projects.find((item) => item.id === id),
    );
  }
  const jobRoute = /^\/api\/generation-jobs\/(\d+)\/jobs(?:\/([^/]+))?$/.exec(url.pathname);
  if (jobRoute) {
    if (request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      const id = crypto.randomUUID();
      const job = {
        id,
        projectId: Number(jobRoute[1]),
        nodeId: input.nodeId,
        kind: input.kind,
        input: input.input,
        status: "running",
        resultUrl: null as string | null,
        error: null,
      };
      jobs.set(id, job);
      generationPending = true;
      releaseGeneration = () => {
        job.status = "succeeded";
        job.resultUrl = "/desktop/project.svg";
        generationPending = false;
      };
      return send(job, 202);
    }
    return send(jobs.get(jobRoute[2] ?? "") ?? {}, 200);
  }
  if (url.pathname === "/api/generate") {
    generationPending = true;
    await new Promise<void>((done) => {
      releaseGeneration = done;
    });
    generationPending = false;
    return send({ url: "/desktop/project.svg" });
  }
  try {
    let path = resolve(web, `.${url.pathname}`);
    if (!path.startsWith(`${resolve(web)}/`) && path !== resolve(web)) return send({}, 403);
    if (statSync(path).isDirectory()) path = join(path, "index.html");
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    };
    response.writeHead(200, { "Content-Type": types[extname(path)] ?? "text/plain" });
    response.end(readFileSync(path));
  } catch {
    send({}, 404);
  }
});
let window: BrowserWindow;
const run = <T = unknown>(code: string): Promise<T> => window.webContents.executeJavaScript(code);
async function wait(check: () => boolean | Promise<boolean>, label: string) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Timed out: ${label}`);
}
const panel = (id: number) => `.desktop-panel[data-project-id="${id}"]`;
async function click(selector: string) {
  assert.equal(
    await run(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click(); return true;
  })()`),
    true,
    `missing click target: ${selector}`,
  );
}
async function tab(name: string) {
  await run(
    `[...document.querySelectorAll('[role=tab]')].find(n => n.textContent.trim() === ${JSON.stringify(name)})?.click()`,
  );
  await new Promise((done) => setTimeout(done, 60));
}
async function open(id: number) {
  await click('[aria-label="项目首页"]');
  await click(`a[href*="id=${id}"]`);
  await wait(
    () => run<boolean>(`!!document.querySelector('${panel(id)} .react-flow')`),
    `canvas ${id}`,
  );
}
const count = (id: number) =>
  run<number>(`document.querySelectorAll('${panel(id)} .react-flow__node').length`);
async function addText(id: number) {
  const before = await count(id);
  await click(`${panel(id)} [aria-label="添加文本节点"]`);
  await wait(async () => (await count(id)) === before + 1, "text node appears");
}
async function snapshot(name: string) {
  await new Promise((done) => setTimeout(done, 150));
  writeFileSync(join(artifacts, name), (await window.capturePage()).toPNG());
}

// Compare rendered pixels, rather than just checking the parent panel's CSS.
async function panelPixels() {
  await new Promise((done) => setTimeout(done, 150));
  return Promise.all(
    [300, 1040].map(async (x) =>
      (await window.capturePage({ x, y: 320, width: 8, height: 8 })).toBitmap(),
    ),
  );
}
function assertPanelPixels(before: Buffer[], after: Buffer[], message: string) {
  assert.equal(
    before.every((pixels, index) => pixels.equals(after[index] ?? Buffer.alloc(0))),
    true,
    message,
  );
}
const mediaLayout = () =>
  run<string>(`JSON.stringify([...document.querySelectorAll('${panel(3)} .react-flow__node')].map(n=>{
  const r=n.getBoundingClientRect();return {id:n.dataset.id,x:r.x,y:r.y,width:r.width,height:r.height};
}))`);

void app
  .whenReady()
  .then(async () => {
    nativeTheme.themeSource = "light";
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    window = createProjectWindow();
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error("renderer:", event.message);
    });
    installDesktopWindowApi(window);
    protectWindowClose(window);
    await window.loadURL(`http://127.0.0.1:${address.port}/`);
    try {
      await wait(
        () =>
          run<boolean>(
            "!!document.querySelector('.desktop-titlebar') && document.querySelectorAll('a[href*=projects]').length === 3",
          ),
        "workspace hydration",
      );
      await open(1);
      await wait(() => nativeTheme.themeSource === "system", "system appearance remains enabled");
      if (await run<boolean>("document.documentElement.classList.contains('dark')"))
        await click(`${panel(1)} [aria-label="切换为浅色"]`);
      await click('[aria-label="项目首页"]');
      await run("document.fonts.ready.then(() => true)");
      const homePixels = await panelPixels();
      await tab(names[0] ?? "");
      await addText(1);
      await click(`${panel(1)} .react-flow__node`);
      await click(`${panel(1)} [aria-label="放大"]`);
      await new Promise((done) => setTimeout(done, 400));
      const viewport = await run<string>(
        `document.querySelector('${panel(1)} .react-flow__viewport').style.transform`,
      );
      await open(2);
      await addText(2);
      await run(
        "document.activeElement?.blur(); window.dispatchEvent(new KeyboardEvent('keydown', {key:'z',ctrlKey:true,bubbles:true}))",
      );
      await wait(async () => (await count(2)) === 0, "active undo");
      assert.equal(await count(1), 1);
      const otherProjectPixels = await panelPixels();
      await open(3);
      await wait(
        () =>
          run<boolean>(
            `document.querySelectorAll('${panel(3)} .react-flow__node').length===2 && [...document.querySelectorAll('${panel(3)} .react-flow__node')].every(n=>getComputedStyle(n).visibility==='visible')`,
          ),
        "media nodes measured and visible",
      );
      const layout = await mediaLayout();
      await click('[aria-label="项目首页"]');
      await snapshot("home-after-media.png");
      assertPanelPixels(
        homePixels,
        await panelPixels(),
        "inactive media nodes must not paint over Home",
      );
      assert.equal(await mediaLayout(), layout, "hidden media nodes keep their layout dimensions");
      await tab(names[1] ?? "");
      assertPanelPixels(
        otherProjectPixels,
        await panelPixels(),
        "inactive media nodes must not paint over another project",
      );
      await tab(names[2] ?? "");
      assert.equal(
        await mediaLayout(),
        layout,
        "returning to media project preserves node positions",
      );
      console.log(
        "PASS media canvas does not paint over Home or other projects; layout survives switching",
      );
      await tab(names[0] ?? "");
      assert.equal(
        await run(`document.querySelector('${panel(1)} .react-flow__viewport').style.transform`),
        viewport,
      );
      assert.equal(
        await run(`!!document.querySelector('${panel(1)} .react-flow__node.selected')`),
        true,
      );
      assert.equal(await run("document.querySelectorAll('[role=tab]').length"), 3);
      await open(1);
      assert.equal(await run("document.querySelectorAll('[role=tab]').length"), 3);
      assert.equal(
        await run("document.querySelector('.desktop-titlebar').getBoundingClientRect().height"),
        48,
      );
      assert.equal(
        await run(
          `document.querySelector('${panel(1)} .react-flow').getBoundingClientRect().height`,
        ),
        (window.getContentSize()[1] ?? 900) - 48,
      );
      assert.equal(
        await run(
          "document.querySelectorAll('button[aria-label*=打开其他], button[aria-label*=全部项目]').length",
        ),
        0,
      );
      for (const [selector, size] of [
        [".desktop-home-icon", 18],
        [".desktop-project-icon", 16],
      ] as const) {
        assert.equal(
          await run(`document.querySelector('${selector}').getBoundingClientRect().width`),
          size,
        );
        assert.ok(
          await run<string>(`getComputedStyle(document.querySelector('${selector}')).maskImage`),
        );
      }
      await snapshot("light.png");
      await click(`${panel(1)} [aria-label="切换为深色"]`);
      await wait(
        () => run<boolean>("document.documentElement.classList.contains('dark')"),
        "dark theme",
      );
      await snapshot("dark.png");
      await click(`${panel(1)} [aria-label="切换为浅色"]`);
      window.setSize(960, 600);
      await wait(
        () =>
          run<boolean>(
            "document.querySelector('.desktop-tab').getBoundingClientRect().width === 144",
          ),
        "narrow tabs",
      );
      await snapshot("narrow.png");
      window.setSize(1440, 900);
      window.webContents.send("desktop:window-state", { platform: "win32", fullscreen: false });
      await wait(
        () =>
          run<boolean>(
            "getComputedStyle(document.querySelector('.desktop-titlebar')).paddingRight === '138px'",
          ),
        "Windows caption reserve fallback",
      );
      assert.equal(await run("document.querySelectorAll('.desktop-native-space').length"), 0);
      window.webContents.send("desktop:window-state", {
        platform: process.platform,
        fullscreen: false,
      });
      console.log(
        "PASS retained selection / viewport / undo, deduplication, dimensions and themes",
      );

      await click('[aria-label="项目首页"]');
      window.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "Tab",
        modifiers: ["control", "shift"],
      });
      window.webContents.sendInputEvent({
        type: "keyUp",
        keyCode: "Tab",
        modifiers: ["control", "shift"],
      });
      await wait(
        () =>
          run<boolean>(
            `document.querySelector('[role=tab][aria-selected=true]').textContent.trim() === '${names[2]}'`,
          ),
        "previous shortcut from Home selects the last project",
      );
      await tab(names[0] ?? "");

      // Exercise the rendered drag handlers instead of dispatching a reducer directly.
      await run(`{
      const tabs=[...document.querySelectorAll('[role=tab]')];
      const data=new DataTransfer();
      tabs[1].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
      const target=tabs[0].parentElement, rect=target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data,clientX:rect.left+2}));
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:rect.left+2}));
      tabs[1].dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));
    }`);
      await wait(
        () =>
          run<boolean>(`document.querySelector('[role=tab]').textContent.trim() === '${names[1]}'`),
        "drag order",
      );
      assert.equal(
        await run("document.querySelector('[role=tab][aria-selected=true]').textContent.trim()"),
        names[0],
      );
      await new Promise((done) => setTimeout(done, 120));
      window.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "Tab",
        modifiers: ["control"],
      });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab", modifiers: ["control"] });
      await wait(
        () =>
          run<boolean>(
            `document.querySelector('[role=tab][aria-selected=true]').textContent.trim() === '${names[2]}'`,
          ),
        "native tab shortcut",
      );
      console.log("PASS drag sorting keeps selected project and native Ctrl+Tab switches");

      await tab(names[1] ?? "");
      await click(`${panel(2)} [aria-label="添加图像生成节点"]`);
      await click(`${panel(2)} .react-flow__node-image-gen`);
      await run(`{
      const input=document.querySelector('${panel(2)} [contenteditable=true]');
      input.textContent='柔和光线'; input.dispatchEvent(new InputEvent('input',{bubbles:true}));
    }`);
      await wait(
        () =>
          run<boolean>(
            `[...document.querySelectorAll('${panel(2)} button')].some(b => b.textContent.trim()==='生成' && !b.disabled)`,
          ),
        "generation prompt",
      );
      await run(
        `[...document.querySelectorAll('${panel(2)} button')].find(b => b.textContent.trim()==='生成').click()`,
      );
      await wait(() => generationPending, "mock generation starts");
      await click(`[aria-label="关闭 ${names[1]}"]`);
      await wait(
        () => prompts.some((message) => message.includes("任务进行中")),
        "running-task close confirmation",
      );
      assert.equal(await run("document.querySelectorAll('[role=tab]').length"), 3);
      await tab(names[0] ?? "");
      releaseGeneration?.();
      await wait(
        () => graphs.get(2)?.nodes.some((node) => node.data.status === "ready") === true,
        "background generation autosaves",
      );
      console.log("PASS running-task close protection and hidden project generation");

      rejectWrites = true;
      await addText(1);
      const promptCount = prompts.length;
      await click(`[aria-label="关闭 ${names[0]}"]`);
      await wait(() => prompts.length > promptCount, "failed save prompt");
      assert.equal(await run("document.querySelectorAll('[role=tab]').length"), 3);
      assert.equal(await count(1), 2);
      rejectWrites = false;
      await click(`[aria-label="关闭 ${names[0]}"]`);
      await wait(
        () => run<boolean>("document.querySelectorAll('[role=tab]').length === 2"),
        "close after retry",
      );
      assert.equal(graphs.get(1)?.nodes.length, 2);
      await click(`[aria-label="关闭 ${names[1]}"]`);
      await wait(
        () => run<boolean>("document.querySelectorAll('[role=tab]').length === 1"),
        "second close",
      );
      await click(`[aria-label="关闭 ${names[2]}"]`);
      await wait(
        () => run<boolean>("document.querySelectorAll('[role=tab]').length === 0"),
        "last close returns home",
      );
      console.log(
        "PASS failed save cancels close, successful retry flushes latest graph, last close returns Home",
      );

      await open(1);
      await addText(1);
      await open(2);
      await addText(2);
      await tab(names[0] ?? "");
      await run(
        `document.querySelector('${panel(1)} button[title="双击重命名"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
      );
      await wait(
        () =>
          run<boolean>(`(() => {
            const input = document.querySelector('${panel(1)} input[maxlength="100"]');
            return !!input && document.activeElement === input;
          })()`),
        "project name input focused",
      );
      // 输入框挂载和 focus effect 不在同一步，确认焦点后再使用原生输入。
      await window.webContents.insertText("播客最终项目名");
      await wait(
        () =>
          run<boolean>(
            `document.querySelector('${panel(1)} input[maxlength="100"]')?.value === '播客最终项目名'`,
          ),
        "project name entered before close",
      );
      rejectWrites = true;
      const beforeWindowClose = prompts.length;
      window.close();
      await wait(() => prompts.length > beforeWindowClose, "native close protects every project");
      assert.equal(window.isDestroyed(), false);
      rejectWrites = false;
      window.close();
      await wait(() => window.isDestroyed(), "native window close after saving");
      assert.equal(graphs.get(1)?.nodes.length, 3);
      assert.equal(graphs.get(2)?.nodes.length, 2);
      assert.equal(projects[0]?.name, "播客最终项目名");
      console.log(`PASS window save protection; screenshots: ${artifacts}`);
      // A crashed or unmounted renderer must still allow an explicitly confirmed exit.
      window = createProjectWindow();
      installDesktopWindowApi(window);
      protectWindowClose(window);
      await window.loadURL("data:text/html,<h1>Close timeout fixture</h1>");
      responses.push(1);
      window.close();
      for (let attempt = 0; attempt < 200 && !window.isDestroyed(); attempt++)
        await new Promise((done) => setTimeout(done, 100));
      assert.equal(window.isDestroyed(), true);
      assert.ok(prompts.some((message) => message.includes("页面未响应")));
      console.log("PASS unresponsive renderer requires confirmation before exiting");
    } catch (error) {
      if (!window.isDestroyed()) {
        await snapshot("failure.png");
        console.error(
          "UI state:",
          await run(
            "JSON.stringify({text:document.body.innerText,panels:[...document.querySelectorAll('.desktop-panel')].map(n=>({id:n.dataset.projectId,active:n.dataset.active})),location:location.href})",
          ),
        );
        console.error("artifacts:", artifacts);
      }
      throw error;
    } finally {
      if (!window.isDestroyed()) window.destroy();
      server.closeAllConnections();
      server.close();
    }
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
