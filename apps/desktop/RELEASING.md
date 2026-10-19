# 桌面端签名与更新

## 用户如何更新

正式版启动 15 秒后检查一次 GitHub Releases。也可以在 macOS 的 AIGC-FLOW 菜单中选择
“检查更新”，或在 Windows 按 Alt 打开菜单后选择“帮助 → 检查更新”。快捷键为
Cmd/Ctrl + Shift + U。

发现新版后先询问是否下载；下载进度显示在菜单和 Dock / 任务栏中。下载完成后再次询问
是否重启安装。选择“稍后”后，可以用同一菜单继续安装；普通退出不会自动安装。
安装前会保存全部项目，保存失败可以取消。生成任务和 AI 对话会被重启中断，应先等待完成。
安装阶段失败时会恢复项目窗口并提示错误。

仅跟随正式版本，不接收预发布，也不降级。当前公开更新源是
[qianyuzhao-ai/AIGC-FLOW Releases](https://github.com/qianyuzhao-ai/AIGC-FLOW/releases)，
应用中不包含 GitHub Token。若将仓库改为私有，必须先迁移到公开更新源。

0.3.0 及更早的版本没有更新器，用户需要手动安装一次首个支持更新的签名版本。
macOS 用户应将应用复制到“应用程序”后再使用更新功能，不要直接从 DMG 中运行。
更新继续使用 `com.aigcflow.desktop` 与现有 `AIGC-FLOW` 用户数据目录，不迁移或清空项目。

## 一次性创建 Apple 证书

这里使用 App Store 之外的直接分发，需要 **Developer ID Application** 证书和 Apple 公证。
付费开发者会员本身不会生成签名证书。参见
[Apple Developer ID 指南](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)。

1. 在 Mac 的“钥匙串访问”中，通过“证书助理 → 从证书颁发机构请求证书”创建 CSR，保存到磁盘。
2. 在 Apple Developer 的 Certificates, Identifiers & Profiles 中新建
   **Developer ID Application** 证书，上传 CSR，下载 `.cer`。按 Apple 页面提示选择证书选项。
3. 在创建 CSR 的同一台 Mac 上双击 `.cer`，导入登录钥匙串。
4. 打开“我的证书”，确认 `Developer ID Application: 姓名或组织 (TEAMID)` 下有对应私钥。
   将这个签名身份导出为 `.p12`，设置一个非空导出密码。只有 `.cer` 不足以让 CI 签名。
5. 在开发者账号的 Membership details 中记录 Team ID。在
   [Apple Account](https://account.apple.com/) 的登录与安全设置中创建 App 专用密码，
   用于公证。不要使用 Apple 账号主密码。

证书导出参考 [Apple 签名身份说明](https://developer.apple.com/documentation/Xcode/sharing-your-teams-signing-certificates)，
App 专用密码参考 [Apple 支持文档](https://support.apple.com/en-us/102654)。
可用以下只读命令确认本机能找到签名身份：

```sh
security find-identity -v -p codesigning
```

## 配置 GitHub Actions Secrets

在仓库 [Settings → Secrets and variables → Actions](https://github.com/qianyuzhao-ai/AIGC-FLOW/settings/secrets/actions)
中添加以下 Repository secrets。不要把值写入源码、提交记录、日志或聊天。

| Secret | 值 |
| --- | --- |
| `CSC_LINK` | 包含证书和私钥的 `.p12` 文件的 Base64 内容 |
| `CSC_KEY_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_ID` | 有权进行公证的 Apple 账号邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple App 专用密码 |
| `APPLE_TEAM_ID` | 证书所属开发者团队的 Team ID |

使用已登录的 GitHub CLI 时，可以直接管道上传证书，避免将 Base64 打印到终端：

```sh
base64 -i "/绝对路径/DeveloperID.p12" | gh secret set CSC_LINK --repo qianyuzhao-ai/AIGC-FLOW
gh secret set CSC_KEY_PASSWORD --repo qianyuzhao-ai/AIGC-FLOW
gh secret set APPLE_ID --repo qianyuzhao-ai/AIGC-FLOW
gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo qianyuzhao-ai/AIGC-FLOW
gh secret set APPLE_TEAM_ID --repo qianyuzhao-ai/AIGC-FLOW
```

后四条命令使用交互提示输入值。Apple 主密码变化会撤销已有 App 专用密码，需要重新配置。
后续发布保持同一应用身份和开发者团队；不要随意更换签名团队。

## 发布与校验

沿用根 README 的 `功能分支 → dev → main → 新版本标签` 流程。
正式配置为 `electron-builder.yml`。macOS 缺少签名或公证凭据会失败，不允许静默发布未签名包。
CI 导入证书，用 Developer ID 签名，再由 electron-builder 调用 Apple 公证并附加票据。
打包后分别对 arm64 / x64 执行 `codesign`、`stapler validate` 和 `spctl` 检查。

更新依赖 `latest-mac.yml`、`latest.yml`、ZIP / EXE 和 blockmap。macOS 的清单必须同时包含
arm64 / x64 的 ZIP 和 DMG。CI 核对清单版本、文件集合、SHA-512 和大小后，才上传产物。
发布任务收齐五个安装包、两个清单、五个 blockmap 和 SHA-256 校验和后公开 Release。
GitHub 的预发布仍可用于手动安装，但本应用的更新器只查询正式版本。

相关行为以当前使用的
[electron-builder v26 更新文档](https://www.electron.build/v26/docs/features/auto-update/)
和 [签名文档](https://www.electron.build/v26/docs/features/code-signing/) 为准。

本地 `pnpm dist:mac` / `pnpm dist:win` 使用 `electron-builder.local.yml`，不上传产物，
不连接更新源。macOS 测试包使用单独的 ad-hoc 签名权限，不代表正式签名或公证成功。

## 验收

```sh
pnpm typecheck
pnpm lint
pnpm --filter @aigc-flow/desktop test
pnpm --filter @aigc-flow/desktop test:update
node --test .github/scripts/*.test.mjs
```

`test:update` 使用隔离用户目录、模拟更新后端和真实 Electron 窗口，覆盖菜单操作、
保存失败取消、重试复用下载、窗口关闭后才安装，以及安装错误恢复，不访问正式数据或发布源。

签名发布前仍须实机验收：

1. 在 Apple Silicon 和 Intel Mac 上打开首个签名版本，确认 Gatekeeper 正常放行。
2. 在专门的测试更新源准备两个递增版本，均用同一团队签名、公证。先安装较低版本到
   “应用程序”，测试检查、下载、延后、重启安装，确认版本升级且项目与配置保留。
3. 保存失败时取消安装；下载时断网后重试；核对最新版本提示。正式更新源仅在完成
   发布验证后推送新标签，不为测试覆盖公开版本。
4. 在 Windows 实机安装旧版 NSIS，再验证升级及项目保留。Apple 证书不能给 Windows 签名，
   Windows Authenticode 签名需要另外配置证书。

日志位于用户数据目录的 `logs/main.log`，更新记录以 `[updater]` 标记。
macOS 对应 `~/Library/Application Support/AIGC-FLOW/logs/main.log`。
