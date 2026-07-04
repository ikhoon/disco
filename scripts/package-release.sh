#!/usr/bin/env bash
# package-release.sh — build the shippable disco release artifact:
#   dist/disco-<version>-macos-arm64.zip
#
# Stages the compiled binary plus a short README in the exact layout the
# Homebrew formula expects (a single disco-<version>/ top-level dir that
# Homebrew strips on unpack). Mirrors macmail's release packaging, minus the
# .app bundle / codesign steps — disco needs no TCC identity (no Full Disk
# Access), and bun's --compile output is already ad-hoc signed by the linker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ARCH="arm64" # disco is Apple Silicon only for now (see README).
# We only produce the arm64 artifact; refuse to run on an Intel host, where bun
# would emit an x64 binary that we'd then mislabel as ...-macos-arm64.zip.
HOST_ARCH="$(uname -m)"
if [ "$HOST_ARCH" != "arm64" ]; then
  echo "package-release: must run on Apple Silicon (arm64); host is $HOST_ARCH" >&2
  exit 1
fi

# package.json is the single source of truth for the version; parse it without
# a jq/node dependency.
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)"
[ -n "$VERSION" ] || { echo "package-release: could not read version from package.json" >&2; exit 1; }

# src/version.ts embeds the VERSION const — refuse to ship a mismatched pair.
if ! grep -q "const VERSION = \"${VERSION}\"" src/version.ts; then
  echo "package-release: src/version.ts VERSION != package.json (${VERSION}) — sync them first" >&2
  exit 1
fi

STAGE="dist/disco-${VERSION}"
ZIP="dist/disco-${VERSION}-macos-${ARCH}.zip"

echo "package-release: building disco ${VERSION} (${ARCH})"

mkdir -p dist
bun run build

rm -rf "$STAGE"
mkdir -p "$STAGE"
cp dist/disco "${STAGE}/disco"

# A short README for people who download the zip instead of using brew.
cat > "${STAGE}/README.txt" <<EOF
disco ${VERSION} — Discord activity CLI (Apple Silicon / ${ARCH})

Install (Homebrew, recommended — also sets up shell completion):
  brew install ikhoon/tap/disco

Manual install from this zip:
  xattr -d com.apple.quarantine disco 2>/dev/null || true
  install -m 755 disco ~/.local/bin/disco
  disco completions --install        # optional: per-user shell completion

disco is ad-hoc signed (not notarized), so macOS flags the download; the xattr
line clears it. Docs: https://github.com/ikhoon/disco
EOF

# Zip it. ditto is the macOS-native archiver: --keepParent keeps the
# disco-<version>/ top-level dir; --norsrc/--noextattr drop resource forks +
# extended attributes so the archive has no ._* sidecar files.
rm -f "$ZIP"
ditto -c -k --keepParent --norsrc --noextattr "$STAGE" "$ZIP"

echo "package-release: wrote ${ZIP}"
shasum -a 256 "$ZIP"
