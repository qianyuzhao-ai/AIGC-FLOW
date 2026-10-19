export async function releaseState(repository, tag, token, request = fetch) {
  const response = await request(
    `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.status === 404) return "absent";
  if (!response.ok) throw new Error(`读取 Release 失败：HTTP ${response.status}`);
  return (await response.json()).draft ? "draft" : "published";
}
