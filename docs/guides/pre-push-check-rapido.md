# Quick Pre-Push Check (circuits)

Minimal guide to validate local artifact changes before pushing to `main`.

## 1) Local build

```bash
npm run build-all
```

## 2) Convert to `.ark` (if needed)

```bash
npm run convert:disclosure
npm run convert:transfer
npm run convert:unshield
npm run convert:private-link
```

## 3) Strict manifest

```bash
MANIFEST_REQUIRE_ALL=true npm run manifest
```

It must include all 4 circuits: `disclosure`, `transfer`, `unshield`, `private_link`.

## 4) Compare against CDN/NPM

```bash
npm run check-artifacts
```

Quick interpretation:

- `✓ sync`: local hash == remote hash.
- `✗ stale`: your local artifact changed and remote is outdated.

## 5) What to do if `✗ stale` appears on `.zkey/.ark/verification_key_*.json`

This is **expected** when keys or VK files are regenerated locally.

- If you want to publish those changes:
    1. Commit your changes.
    2. Bump the version in `package.json`.
    3. Push to `main` (this triggers the release workflow).

The release pipeline handles:

- strict manifest generation,
- npm publishing,
- CDN sync,
- checksum refresh.

## 6) “Ready to push” criteria

- `build-all` completes successfully.
- strict `manifest` generation completes successfully.
- `check-artifacts` runs without execution errors (even if `✗ stale` appears before publishing).
- If you want remotes fully updated: bump version + push to `main`.
