export async function releaseState(repository, tag, token, request = fetch) {
  const get = (url) =>
    request(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30_000),
    });
  const endpoint = `https://api.github.com/repos/${repository}/releases`;
  const response = await get(`${endpoint}/tags/${encodeURIComponent(tag)}`);
  if (response.status !== 404) {
    if (!response.ok) throw new Error(`读取 Release 失败：HTTP ${response.status}`);
    return (await response.json()).draft ? "draft" : "published";
  }
  for (let page = 1; ; page++) {
    const listing = await get(`${endpoint}?per_page=100&page=${page}`);
    if (!listing.ok) throw new Error(`读取 Release 列表失败：HTTP ${listing.status}`);
    const releases = await listing.json();
    const release = releases.find((item) => item.tag_name === tag);
    if (release) return release.draft ? "draft" : "published";
    if (releases.length < 100) return "absent";
  }
}
