#!/bin/bash
# Manual release for orbinum-circuits: npm publish + git tag + GitHub release.
# Replaces the old auto-release CI workflow.
#
# Assumes circuits are ALREADY BUILT locally (build/ + keys/) and manifest.json
# is already regenerated and COMMITTED. Never rebuilds anything: published
# artifacts are immutable, and every file is sha256-verified against the
# committed manifest before anything is published. See docs/RELEASE.md.
#
# Usage: bash scripts/release/release.sh [--dry-run]
#
# Prereqs: npm login (publish rights to @orbinum), gh auth login.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

die() {
    echo -e "${RED}✗ $1${NC}" >&2
    exit 1
}

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

for tool in node pnpm git gh; do
    command -v "$tool" > /dev/null || die "required tool not found: $tool"
done

# ── Guard rails (fail-closed) ────────────────────────────────────────────────
git diff --quiet && git diff --cached --quiet || die "git working tree is dirty — commit or stash first"

VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
MANIFEST_VERSION=$(node -p "require('./manifest.json').package_version")
[ "$MANIFEST_VERSION" = "$VERSION" ] ||
    die "manifest package_version ($MANIFEST_VERSION) != package.json version ($VERSION) — regenerate & commit the manifest"

git rev-parse -q --verify "refs/tags/$TAG" > /dev/null && die "tag $TAG already exists locally"
git ls-remote --exit-code --tags origin "refs/tags/$TAG" > /dev/null 2>&1 && die "tag $TAG already exists on origin"

# ── Verify local artifacts == committed manifest (sha256) ────────────────────
pnpm exec ts-node scripts/release/verify-artifacts.ts

# ── Assemble pkg/ from the manifest (it is the packing list) ─────────────────
rm -rf pkg release
mkdir -p pkg release

cp manifest.json pkg/
# TSV: artifact kind, published filename, repo-local path — for every version
node -e '
const m = require("./manifest.json");
for (const c of Object.values(m.circuits))
    for (const v of Object.values(c.versions))
        for (const [kind, a] of Object.entries(v.artifacts))
            console.log([kind, a.file, a.localPath].join("\t"));
' > release/artifacts.tsv

while IFS=$'\t' read -r kind file local; do
    cp "$local" "pkg/$file"
done < release/artifacts.tsv

cp npm/README.md npm/index.js npm/index.d.ts LICENSE pkg/
sed "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" npm/package.json.template > pkg/package.json

# ── Tarballs + checksums (same asset names the old CI release produced) ──────
mkdir -p release/arkworks release/snarkjs release/vks
while IFS=$'\t' read -r kind file local; do
    case "$kind" in
        wasm | ark) cp "pkg/$file" release/arkworks/ ;;
        zkey) cp "pkg/$file" release/snarkjs/ ;;
        vk_json) cp "pkg/$file" release/vks/ ;;
    esac
done < release/artifacts.tsv

tar -czf "release/orbinum-circuits-${TAG}.tar.gz" -C release/arkworks .
tar -czf "release/orbinum-circuits-snarkjs-${TAG}.tar.gz" -C release/snarkjs .
tar -czf "release/orbinum-verification-keys-${TAG}.tar.gz" -C release/vks .
(cd pkg && shasum -a 256 ./*) > "release/checksums-${TAG}.txt"

# ── Release notes: the [$VERSION] section of CHANGELOG.md ────────────────────
awk -v ver="$VERSION" '
    $0 ~ "^## \\[" ver "\\]" {flag=1; next}
    /^## \[/ {if (flag) exit}
    flag' CHANGELOG.md > release/release_notes.md
[ -s release/release_notes.md ] || echo "Release ${TAG}." > release/release_notes.md

# ── npm ──────────────────────────────────────────────────────────────────────
if npm view "@orbinum/circuits@${VERSION}" version > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠ @orbinum/circuits@${VERSION} already on npm — skipping publish${NC}"
elif $DRY_RUN; then
    (cd pkg && pnpm publish --no-git-checks --dry-run)
else
    (cd pkg && pnpm publish --no-git-checks)
fi

# ── Git tag + GitHub release (last, so a partial failure is rerunnable) ──────
if $DRY_RUN; then
    echo -e "${YELLOW}[dry-run] skipping: git tag $TAG, git push, gh release create${NC}"
else
    git tag -a "$TAG" -m "Release $TAG"
    git push origin "$TAG"
    gh release create "$TAG" \
        "release/orbinum-circuits-${TAG}.tar.gz" \
        "release/orbinum-circuits-snarkjs-${TAG}.tar.gz" \
        "release/orbinum-verification-keys-${TAG}.tar.gz" \
        "release/checksums-${TAG}.txt" \
        --title "Release $TAG" --notes-file release/release_notes.md
fi

echo -e "${GREEN}✓ Release $TAG complete$($DRY_RUN && echo ' (dry run)' || true)${NC}"
