module.exports = (context) => {
  if (context.electronPlatformName !== "darwin") return;
  const mac = context.packager.platformSpecificBuildOptions;
  if (!mac.forceCodeSigning) return;
  if (mac.identity === "-" || mac.notarize === false) {
    throw new Error("正式 macOS 包必须使用 Developer ID 签名并公证");
  }
  const required = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(
      `缺少公证环境变量：${missing.join(", ")}。本地测试请使用 electron-builder.local.yml`,
    );
  }
};
