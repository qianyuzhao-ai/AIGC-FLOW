# AIGC-FLOW
画布节点工作，用于调用各种模型进行影视资产创作

## Pi 对话与模型配置

需要 Node.js 22.19+。在画布的「设置 → Pi 模型」选择服务、填写 API Key 和模型，
也可以添加 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages 兼容服务。
先保存，再使用「验证已保存的模型」。这会向该模型发送一次短请求。

接入第三方聚合服务时，选择「添加第三方聚合 / 自定义 API」，填写服务名称、
Base URL 和该服务的 API Key，再点击「读取模型」从其 `/models` 接口获取可选项。
模型 ID 会原样传给聚合服务；没有模型列表接口时可手动填写。保存后可直接选择该服务，
修改地址、模型和 Key。读取列表不会保存配置，留空 Key 只会沿用同一地址已保存的凭据。

画布工具栏的 Pi 按钮打开对话侧栏。回复支持流式显示和停止，对话历史按项目保存，
重新打开或重启应用后可查看历史。Agent 可以读取当前画布、创建文本／图片／视频节点、
修改提示词与生成参数、连接节点、排列、编组和解组。例如：

- 「创建三个图片节点，分别填入以下提示词，再横向排列」
- 「把这个图片节点连接到视频节点，生成一段视频」

明确要求生成后，Agent 会按顺序调用现有图片／视频服务，每个指定节点生成一次，
等待真实结果写回画布后继续。讨论创意不会直接修改或生成；当前只读取文本、参数与
结构，不理解图片／视频内容。聚合服务需要支持工具调用；设置页的模型验证只验证文本回复。

工具操作与保存状态显示在聊天中，每次画布修改可以单独撤销。手动编辑造成冲突时，
Agent 会重新读取；撤销不取消已提交的生成，也不撤销其结果。关闭侧栏或在应用内切换
项目会继续运行。停止按钮阻止后续操作和生成提交，已提交给上游的生成会继续接收结果。

运行迁移 `0006`、`0007` 后，SQLite 保存任务、命令、生成请求与画布版本。客户端
重连会查询原任务，不重复执行命令或生成。退出／重启应用不会自动恢复执行；中断任务
和无法确认的生成会标记为中断或结果未知，不会自动重试。

Pi 使用数据库所在目录下的 `pi/` 保存 `auth.json`、`models.json`、`settings.json`
以及项目会话；不会使用用户独立安装的 Pi 配置。Web 开发时通常是
`apps/server/data/pi/`，桌面端在应用用户数据目录的 `data/pi/`。不要提交该目录，
也不要把配置文件中的凭据发到客户端。

旧 LLM 配置已移除。运行 `pnpm db:migrate` 会清除 SQLite 中旧的三个 LLM 配置项，
需要在 Pi 模型中重新配置。内网素材上传和图片／视频生成仍使用原来的内网服务设置。

双人播客分镜表功能已移除。旧项目或旧剪贴板中的分镜表节点在读取时转为普通文本节点，
保留名称、位置、尺寸、编组和已填内容；之后按普通文本编辑并保存。

本地模拟模型集成测试（不会调用付费服务）：

```sh
cd apps/server
node --import tsx --test src/pi/*.test.ts ../client/src/lib/agent/*.test.ts
```

## 桌面项目标签页

Electron 桌面端使用 48px 全高标签栏，保留原生窗口控制。点击项目首页中的卡片打开
项目；再次打开同一项目会切换到已有标签。Home 返回首页，项目标签可拖动排序、点击
`×` 关闭。顶部不提供 Open Project 或 All Open Project 按钮。

每个画布在当前窗口中保持挂载，切换保留视角、选择、撤销栈和未提交输入。隐藏画布
暂停媒体播放，并禁用画布快捷键和删除键；后台生成仍能完成并自动保存。

关闭标签前会完成保存。保存失败可以取消、重试或明确放弃更改；任务进行中会先确认。
关闭当前标签后选中最近访问的项目，关闭最后一个标签返回首页。关闭窗口或退出应用
会检查所有已打开项目。关闭标签不会删除项目，打开的标签与排序仅保留在本次窗口会话。

快捷键：`Ctrl+Tab` / `Ctrl+Shift+Tab` 切换项目，`⌘/Ctrl+W` 关闭当前项目标签。

## 验证

```sh
pnpm typecheck
pnpm lint
pnpm --filter @aigc-flow/desktop test
pnpm --filter @aigc-flow/server exec node --import tsx --test ../client/src/lib/graph.test.ts
pnpm --filter @aigc-flow/desktop build:web
AIGC_TEST_WEB="$PWD/apps/client/out" pnpm --filter @aigc-flow/desktop test:smoke
```

Electron 集成测试使用临时用户目录、内存项目 API 和模拟生成请求，不连接用户数据库
或付费模型。测试覆盖项目去重、切换保留状态、快捷键隔离、拖动排序、主题与窄窗口、
后台生成、保存失败取消关闭以及关闭窗口前保存全部项目，并在临时目录生成截图。

若构建环境限制 Turbopack 的子进程绑定端口，可以使用 Next.js 官方 webpack 构建器：

```sh
DESKTOP=1 pnpm --filter @aigc-flow/client exec next build --webpack
```

Windows 的原生 Window Controls Overlay 和高 DPI 行为需要在 Windows 实机确认。

## 版本发布

更新内容见 [CHANGELOG.md](CHANGELOG.md)。根目录和四个 workspace 包的版本号保持一致，
安装包版本取自 `apps/desktop/package.json`。

1. 从最新 `dev` 创建 `chore/release-<version>`，更新版本号和更新记录，完成上述验证，
   通过 PR 合并回 `dev`。
2. 从 `dev` 发起到 `main` 的发布 PR，评审并合并后，在该 `main` 提交上创建版本标签
   （例如 `v0.2.0`），标签版本必须与包版本一致。
3. 推送版本标签触发 `.github/workflows/release.yml`，分别构建 macOS arm64 / x64 的
   DMG、ZIP，以及 Windows x64 的 EXE。也可以对已验证的提交手动运行该工作流。
4. 两个平台构建成功后，在 Actions 中下载 `dist-macos-latest` 和 `dist-windows-latest`
   产物，核对安装包版本并完成实机安装验证，再使用同一标签和更新说明发布 GitHub Release。

当前工作流只上传 Actions 构建产物，不会自动创建 GitHub Release；合并 `main` 本身也不会
触发打包。只有版本标签或手动运行工作流才触发构建。
