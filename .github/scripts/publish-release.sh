#!/usr/bin/env bash
set -euo pipefail

cd dist
files=(
  "AIGC-FLOW-${VERSION}-arm64.dmg"
  "AIGC-FLOW-${VERSION}.dmg"
  "AIGC-FLOW-${VERSION}-arm64-mac.zip"
  "AIGC-FLOW-${VERSION}-mac.zip"
  "AIGC-FLOW.Setup.${VERSION}.exe"
)
for file in "${files[@]}"; do
  if [[ ! -s "$file" ]]; then
    echo "::error::缺少安装包：$file"
    exit 1
  fi
done

checksum="aigc-flow-${TAG}-SHA256SUMS.txt"
node --input-type=module - "${files[@]}" > "$checksum" <<'NODE'
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
for (const file of process.argv.slice(2)) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  console.log(`${hash.digest("hex")}  ${file}`);
}
NODE

case "$RELEASE_STATE" in
  absent)
    gh release create "$TAG" --repo "$GITHUB_REPOSITORY" --verify-tag \
      --draft --prerelease="$PRERELEASE" --title "AIGC-FLOW $TAG" \
      --notes-file ../RELEASE_NOTES.md
    ;;
  draft)
    gh release edit "$TAG" --repo "$GITHUB_REPOSITORY" \
      --prerelease="$PRERELEASE" --notes-file ../RELEASE_NOTES.md
    ;;
  *)
    echo "::error::不覆盖已经发布的版本"
    exit 1
    ;;
esac

gh release upload "$TAG" --repo "$GITHUB_REPOSITORY" "${files[@]}" "$checksum" --clobber
gh release edit "$TAG" --repo "$GITHUB_REPOSITORY" --verify-tag --draft=false
