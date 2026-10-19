export function isAllowedMediaSource(url: string): boolean {
  try {
    const { protocol, hostname, username, password } = new URL(url);
    return (
      protocol === "https:" &&
      !username &&
      !password &&
      (hostname === "bcebos.com" || hostname.endsWith(".bcebos.com"))
    );
  } catch {
    return false;
  }
}
