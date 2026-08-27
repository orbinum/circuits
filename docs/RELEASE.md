# Manual Release Process

Releases are **manual and local**. There is no auto-release CI: zkey/VK
generation is nondeterministic (snarkjs mixes OS entropy), so any automated
rebuild mints new VKs whose `vk_hash` no longer matches what is registered
on-chain, and the fail-closed `CircuitVersionResolver` in the SDK would refuse
to generate proofs — stranding every user.

**The rule: published artifacts are never rebuilt. A circuit change is always a
new circuit version (ROTATE mode) plus a new package version — never an
overwrite.**

## Prerequisites

- `npm login` with publish rights to the `@orbinum` scope
- `gh auth login`
- `pack-verifying-key` built in the sibling `groth16-proofs` checkout
  (`cargo build --release --bin pack-verifying-key`), or `PACK_VERIFYING_KEY_BIN` set

## Steps

1. **Restore canonical artifacts** for the circuits you are NOT changing:

    ```bash
    pnpm run release:restore
    ```

    This pulls any missing/drifted artifact from the published npm package and
    sha256-verifies it against the committed manifest. Local rebuilds drift, so
    run this first — the release ships the exact published bytes for unchanged
    circuits.

2. **Build only what changed**: `pnpm run build:circuit <name>`. Never rebuild a
   circuit whose on-chain VK must stay stable. If a circuit's logic changed,
   that is a rotation — build with version-suffixed artifacts (see
   `scripts/build/setup.sh` env vars `SETUP_ENTROPY`/`SETUP_BEACON` for a fresh
   setup) and register the new version on-chain afterwards.

3. **Bump version** in `package.json` and add a `CHANGELOG.md` entry.

4. **Regenerate the manifest** (after the bump, so `package_version` matches):
    - Rotation of one circuit: `ROTATE_CIRCUIT=<name> ROTATE_VERSION=<n> pnpm run manifest`
      (previous version entries are reused verbatim — published bytes are canonical).
    - Removing a circuit / full regeneration from canonical local artifacts:
      `MANIFEST_REQUIRE_ALL=true pnpm run manifest`. This is only safe when every
      local artifact is canonical (step 1) — the generator recomputes hashes from
      local files. Note: `.ark` files convert deterministically from zkeys
      (`pnpm run convert <name>`), so regenerating them from canonical zkeys is safe
      and adds their manifest entries.

5. **Verify locally**:

    ```bash
    pnpm run release:verify   # local artifacts == committed manifest, fail-closed
    pnpm test                 # with pack-verifying-key present: canonical vk_hash check runs
    ```

6. **Commit** the manifest + version bump and merge to `main` via PR (CI
   validates the manifest schema; it does not regenerate it).

7. **Dry-run** from a clean `main` checkout:

    ```bash
    pnpm run release:dry
    ```

    Exercises all guards, assembles `pkg/`, runs `pnpm publish --dry-run`;
    skips tag/GitHub release.

8. **Release**:

    ```bash
    pnpm run release
    ```

    Order: guards → sha256 verify → pkg/ assembly (manifest-driven) → tarballs +
    checksums → npm publish → git tag + GitHub release. A partial failure is
    fixed by re-running: npm skips if already published, and the tag is created
    last.

9. **Register on-chain**: from the node repo, run the VK workflows
   (`node/scripts/vk/workflows/` — `setup-dev.sh`, `vk.sh`, `rotate-dev.sh`),
   which pull the just-published manifest from unpkg.

## Risks / gotchas

- **npm is immutable**: a version can never be republished. A mistake means a
  patch bump with a corrected manifest — never `npm unpublish` (it breaks unpkg
  consumers).
- **unpkg caching**: the unversioned `…/@orbinum/circuits/manifest.json` URL
  resolves to latest with CDN TTL. Before registering on-chain, verify the
  pinned form is live: `curl https://unpkg.com/@orbinum/circuits@<ver>/manifest.json`.
- **Self-hosted mirrors**: consumers can point `baseUrl` at any host serving
  `manifest.json` + artifacts flat (the SDK sha256-verifies everything against
  the manifest). Default distribution is npm/unpkg only.
- The GitHub Actions secrets `NPM_TOKEN`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID` are no longer used and can be revoked.
