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
   that is a rotation: set the rotation variables for the build too, so its
   artifacts get the new version's `_v{n}` names and the published ones stay
   untouched, and give the ceremony fresh entropy and a public beacon:

    ```bash
    export ROTATE_CIRCUIT=transfer,unshield ROTATE_VERSION=2
    export SETUP_BEACON=<recent finalized block hash, no 0x> SETUP_BEACON_ITERS=10
    SETUP_ENTROPY="$(openssl rand -hex 64)" pnpm run build:circuit transfer
    SETUP_ENTROPY="$(openssl rand -hex 64)" pnpm run build:circuit unshield
    ```

    Record the beacon in the CHANGELOG. After the manifest step the source
    builds the active version, so later compiles and fixtures need no variables.
    For a runtime that embeds the keys (node spec 16), run
    `node/scripts/vk/embed-v2.sh` with the new verifying keys and the manifest.

3. **Bump version** in `package.json` and add a `CHANGELOG.md` entry.

4. **Regenerate the manifest** (after the bump, so `package_version` matches):
    - Rotation: `ROTATE_CIRCUIT=<name>[,<name>…] ROTATE_VERSION=<n> pnpm run manifest`. Circuits not listed keep their published entry, so rotating them in separate runs is safe too.
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

6. **Commit** the manifest + version bump and merge to `main` via PR.

    What CI checks on that PR:
    - It **compiles** the circuits and regenerates the fixtures, but never runs
      the trusted setup — the ceremony is nondeterministic, so keys it minted
      could not match the manifest anyway. The canonical zkey, verifying key and
      `.ark` come from `release:restore --keys-only`.
    - It **regenerates the manifest and compares**. A commit that changes a
      `.circom` without running `pnpm run manifest` fails here, with a message
      saying so.
    - It **verifies every `vk_hash`** against `blake2_256` of the packed
      verifying key, and **proves and verifies all three circuits** for real.
    - It does **not** run `release:verify`. That asserts the whole tree matches
      the manifest, wasm and r1cs included, so it fails on any commit that
      legitimately changes a circuit. It stays a pre-publish gate — step 5.

    **Rotation release:** the new ceremony keys exist only on the release
    machine until published, and CI restores keys from npm `latest`. So on the
    release PR the `Build & Test` and `Canonical vk_hash` jobs fail with a 404
    for the new version. Publish from the PR branch (clean tree; steps 7–8),
    re-run CI — it now restores the new keys — and merge without squashing, so
    the tag stays on a commit of `main`. Back up `keys/*_v{n}_pk.*` and
    `build/verification_key_*_v{n}.json` until then.

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
