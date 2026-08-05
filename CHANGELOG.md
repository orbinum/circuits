# Changelog

All notable changes to Orbinum Circuits will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.1] - 2026-08-05

### Changed

- **Releases are now manual** (`scripts/release/release.sh`, see `docs/RELEASE.md`). The automatic release workflow (`.github/workflows/release.yml`) is removed: it rebuilt all circuits on every push to main, and since zkey/VK setup is nondeterministic, each run minted new VKs that no longer matched what was registered on-chain. The release script never rebuilds — it fail-closed sha256-verifies every local artifact against the committed `manifest.json` before publishing to npm and GitHub releases.
- **CI no longer regenerates `manifest.json`**; it validates the committed one instead (`test/manifest_schema.test.ts`) and treats freshly built keys as throwaway circuit-logic validation. The Rust/convert-vk/artifact-upload steps are removed from `ci.yml`.
- **Cloudflare R2 distribution dropped**: npm/unpkg is the only default distribution channel. Consumers needing a mirror can self-host `manifest.json` + artifacts and point `baseUrl` at it (downloads remain sha256-verified against the manifest).

### Added

- `scripts/release/verify-artifacts.ts` (`pnpm run release:verify`) — fail-closed check that local artifacts are byte-identical to the committed manifest.
- `scripts/release/restore-artifacts.ts` (`pnpm run release:restore`) — restores canonical published artifacts from npm into `build/`/`keys/`, sha256-verified.

### Fixed

- **Resynced `manifest.json` to the published `@orbinum/circuits@0.11.0`.** The committed manifest had drifted: the old release CI rebuilt all circuits ~35 minutes after the local build that generated the committed manifest, so npm/on-chain hashes (the canonical ones consumers verify against) differed from git.

## [0.11.0] - 2026-07-07

### Added

- **Multi-version manifest support** in `scripts/utils/generate-manifest.ts`. Setting `ROTATE_CIRCUIT=<circuit>` + `ROTATE_VERSION=<n>` merges a new circuit version onto the existing `manifest.json`: prior versions are reused verbatim, the new one is appended (`supported_versions` grows, `active_version` becomes the new version), and each version's artifacts use version-suffixed filenames (`<circuit>_v<n>_pk.zkey`, etc.) so they don't collide in a flat served directory. Without the env vars, the generator produces the same single-version manifest as before. This lets a VK rotation publish a manifest that keeps the old version spendable while activating the new one.
- **Parametrized trusted setup** in `scripts/build/setup.sh` via `SETUP_ENTROPY` / `SETUP_BEACON` / `SETUP_BEACON_ITERS` (defaults reproduce the original v1 setup byte-for-byte). Lets a new circuit version be generated with genuinely different entropy — required so a rotated VK actually differs from the old one.

### Fixed

- **`setup.sh` cleanup no longer wipes version-suffixed keys.** The previous `rm -f keys/<circuit>_*.zkey` glob would delete `<circuit>_v1_pk.zkey` / `<circuit>_v2_pk.zkey`; it now removes only the numbered intermediates the script creates (`_0000`/`_0001`).

## [0.10.0] - 2026-07-06

### Changed

- **`manifest.json` `vk_hash` is now the canonical on-chain hash** — `blake2_256` of the arkworks-compressed verifying key, byte-for-byte identical to what the chain stores (`sp_io::hashing::blake2_256(vk.key_data)`). Previously it was `sha256` of the snarkjs `verification_key_<circuit>.json`, a different hash over different bytes that could never match the chain. This is what lets the SDK's per-note circuit-version resolver cross-check the prover's VK against the chain's VK before spending a note; with the old value the cross-check could never pass on a real rotation.
    - `generate-manifest` runs the same `convert-vk` (JSON → arkworks binary) the node's VK registration uses, then `blake2_256` of the resulting binary (via `@noble/hashes`, which matches `sp_io::blake2_256`).
    - Requires the `convert-vk` binary at build time (defaults to the sibling `groth16-proofs` release build; override with `CONVERT_VK_BIN`). Fail-closed: manifest generation throws if it is missing rather than falling back to a non-matching hash.
    - The per-artifact `sha256` (download integrity) is unchanged — it and `vk_hash` serve different roles.
    - **Breaking for consumers that read `vk_hash`**: the published value changes format and content.

### Added

- **`test/manifest_vk_hash.test.ts`**: locks `manifest vk_hash == blake2_256(convert-vk(vk.json))` for every circuit, plus the `blake2_256(b"abc")` vector, so the sha256-vs-blake2 mismatch cannot silently return.

## [0.9.0] - 2026-05-14

### Added

- **`value_proof.circom`**: new circuit that lets a relayer prove a note commitment encodes exactly the declared relay fee amount. Replaces `disclosure.circom` as the note-introspection circuit. Used by `pallet-shielded-pool::claim_shielded_fees`.
- **Public signals layout (76 bytes)**: `commitment[0..32] | value[32..40] | asset_id[40..44] | owner_hash[44..76]`.
- **Public inputs**: `commitment` (Field), `value` (u64 LE), `asset_id` (u32 LE).
- **Public output**: `owner_hash = Poseidon(owner_pubkey)` — exposes the owner hash for off-chain audit without revealing the key.
- **Private inputs**: `owner_pubkey`, `blinding`.
- **2 constraints**: commitment verification (`Poseidon(value, asset_id, owner_pubkey, blinding) == commitment`) and owner hash.
- **`CircuitId::VALUE_PROOF = 6`** added to `pallet-zk-verifier` and `primitives/zk-verifier`.
- **`verify_value_proof()`** on the `ZkVerifierPort` trait with its implementation.
- **`test/value_proof.test.ts`**: 16 tests — happy path (6), constraint violations (5), inflation attack (2), owner_hash privacy (2).
- **`docs/circuits/value_proof.md`**: full documentation covering purpose, signals, constraints, comparison table, usage example, and inflation attack analysis.
- **`value_proof` scripts in `package.json` and `scripts/build-all.sh`**: `compile:value-proof`, `setup:value-proof`, `convert:value-proof`, `full-build:value-proof`.
- **`manifest.json`**: `"value_proof"` block with sha256 pending trusted setup.

### Removed

- **`disclosure.circom`**: removed. The on-circuit ECDH Baby Jubjub model is incompatible with the Zcash off-chain viewing-key flow adopted in the `ZCASH_DISCLOSURE_MIGRATION`. Build artifacts (`build/disclosure_js/`, `keys/disclosure_*`) should be deleted from the build environment.
- **`docs/circuits/disclosure.md`**: replaced by `docs/circuits/value_proof.md`.
- **`scripts/generators/`**: entire directory removed (`generate_input.ts`, `generate_unshield_and_private_link_input.js`).
- **`disclosure` scripts from `package.json`**: `compile:disclosure`, `setup:disclosure`, `convert:disclosure`, `full-build:disclosure`.
- **`"disclosure"` block from `manifest.json`**.

### Changed

- **`build-all.sh`**: replaced `"disclosure"` with `"value_proof"` in the `CIRCUITS` array.
- **`config/circuits.config.json`**: removed `disclosure` block; added `value_proof` block with `circuitId: 6`, correct signal counts (3 public inputs, 1 public output, 2 private inputs, ~300 constraints), `encryptionScheme: "none"`, and `publicSignalsLayout`. Performance target updated accordingly.
- **`npm/index.js`**: `CIRCUITS` array and JSDoc — `"disclosure"` → `"value_proof"`.
- **`npm/index.d.ts`**: `CircuitType` union and `getCircuitPaths` parameter — `"disclosure"` → `"value_proof"`.
- **`npm/README.md`**: circuit list, type comments, "Available Circuits" section (Disclosure → Value Proof with correct description), and `generateProof` example updated.
- **`scripts/build/full-pipeline.sh`**: usage comment and inline example — `disclosure` → `value_proof`.
- **`scripts/build/convert-to-ark.sh`**: default circuit name — `disclosure` → `value_proof`.
- **Docs updated**: `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/guides/arkworks-integration.md`, `docs/guides/quick-start.md`, `docs/circuits/note.md`, `docs/circuits/poseidon-wrapper.md` — all references to `disclosure` removed; constraint count table updated with `value_proof`.

### Security

- **Inflation attack prevented**: without `value_proof`, a malicious relayer could insert a commitment built with `value=10000` while claiming only `fee=1000`, then `unshield` that commitment to drain other users' funds. The circuit enforces `commitment == NoteCommitment(declared_value, ...)`.
- **`claim_relay_fees_to_evm` removed from `pallet-shielded-pool`**: that extrinsic exposed relayer funds publicly (no ZK proof), creating relayer↔funds linkability. The only valid path is now `claim_shielded_fees` with a ZK proof.

## [0.8.0] - 2026-05-11

### Added

- **Selective disclosure with ECDH Baby Jubjub (`disclosure.circom`)**: the circuit implements on-circuit encryption using Diffie-Hellman over Baby Jubjub. The auditor exposes a BJJ public key; the prover computes `epk = r·G` and `shared = r·pk_A`, then encrypts selected fields as `enc_field = masked_field + Poseidon(shared.x, shared.y, i)`.
- **New public output signals** (`epk_x`, `epk_y`, `enc_value`, `enc_asset_id`, `enc_owner_hash`): 5 encrypted outputs replacing the previous `revealed_value` plaintext approach.
- **New public input signals** (`auditor_pk_x`, `auditor_pk_y`): auditor's BJJ public key; 3 public inputs total (together with `commitment`).
- **8 private inputs**: `value`, `asset_id`, `owner_pubkey`, `blinding`, `disclose_value`, `disclose_asset_id`, `disclose_owner`, `r` (ephemeral scalar).
- **Poseidon keystream**: `k_i = Poseidon(shared.x, shared.y, i)` per field (i = 0, 1, 2).
- **Owner hash instead of raw pubkey**: `owner_hash = Poseidon(owner_pubkey)` protects the note owner's public key inside the ciphertext.
- **9,411 constraints** (7,557 non-linear + 1,854 linear); within pot16 limit.
- **Rewrite of `test/disclosure.test.ts`** — 7 test sections: commitment verification, ECDH `r·G`, ECDH symmetry, encryption correctness, round-trip with different `r`, boolean mask constraints, owner hash vs raw pubkey.
- **Rewrite of `docs/circuits/disclosure.md`** — new ECDH interface, off-chain decryption guide with circomlibjs, usage examples, updated parameters.
- **Updated `config/circuits.config.json`** — real compiled values for all 3 circuits: `disclosure` (9,411), `transfer` (33,687), `unshield` (16,903).

### Changed

- **`disclosure.circom` — encryption scheme**: `revealed_value` (plaintext field) → on-circuit ECDH with Poseidon keystream.
- **`disclosure.circom` — public inputs**: 8 → 3 (`commitment`, `auditor_pk_x`, `auditor_pk_y`).
- **`disclosure.circom` — public outputs**: 0 → 5 (`epk_x`, `epk_y`, `enc_value`, `enc_asset_id`, `enc_owner_hash`).
- **`disclosure.circom` — constraint count**: ~1,584 → 9,411.
- **`disclosure.circom` — `main` declaration**: `public [commitment, auditor_pk_x, auditor_pk_y]`.
- **`disclosure.circom` — includes**: added `escalarmulany.circom` for `EscalarMulAny` (shared secret `r·pk_A`).
- **`config/circuits.config.json` — `disclosure.encryptionScheme`**: `"none"` → `"ecdh-babyjubjub-poseidon"`.

## [0.7.0] - 2026-05-01

### Added

- **Partial unshield via change note (`unshield.circom`)**: the circuit now accepts an optional change note that returns unspent value back to the pool. The conservation constraint changes from `note_value === amount + fee` to `note_value === amount + fee + change_value`.
- **`change_commitment` public input** (7th public signal): `0` for total unshield; `NoteCommitment(change_value, asset_id, change_owner_pubkey, change_blinding)` for partial unshield.
- **`change_value`, `change_blinding`, `change_owner_pubkey` private inputs**: define the change note. Ignored by the circuit when `change_value == 0`.
- **Constraint 8 — conditional change commitment enforcement** using `IsZero(change_value)`:
    - **8a** (partial): `change_commitment_computer.commitment === change_commitment` when `change_value > 0`.
    - **8b** (total): `change_commitment === 0` when `change_value == 0`.
- **Constraint 9 — `change_value` range check**: `Num2Bits(128)` on `change_value`, consistent with `note_value` and `fee`.
- **New test section 8 "Change note commitment"** (12 tests, `test/unshield.test.ts`):
    - Accepts `change_commitment = 0` for total unshield.
    - Rejects non-zero `change_commitment` when `change_value = 0` (Constraint 8b).
    - Accepts correct `change_commitment` for partial unshield (Constraint 8a).
    - Rejects tampered `change_commitment` (Constraint 8a).
    - Rejects `change_commitment = 0` when `change_value > 0` (Constraint 8a).
    - Rejects wrong `change_blinding` (Constraint 8a).
    - Rejects wrong `change_owner_pubkey` (Constraint 8a).
    - Rejects `change_commitment` forged with a different `asset_id` (Constraint 8a — circuit pins change commitment to `note_asset_id`).
    - Accepts change note to same owner (self-change).
    - Accepts change note to different owner.
    - Accepts `change_value = 2^128 - 1` (max u128, Constraint 9).
    - Rejects `change_value = 2^128` (Constraint 9).
- **New test section 9 "Public signals"** (2 tests): verifies `change_commitment` is exposed correctly as the 7th public signal in both modes.

### Changed

- **`unshield.circom` — conservation constraint**: `note_value === amount + fee` → `note_value === amount + fee + change_value`.
- **`unshield.circom` — public input count**: 6 → 7 (`change_commitment` added).
- **`unshield.circom` — constraint count**: 16,033 → 16,903.
- **`unshield.circom` — `main` declaration**: `public [merkle_root, nullifier, amount, recipient, asset_id, fee, change_commitment]`.
- **Constraint numbering order** in source: Constraint 9 (`change_value` range check) relocated immediately before Constraint 8 (change commitment), grouping all change-note logic together.
- **`test/unshield.test.ts` — `buildInput`**: accepts `changeValue` (default `0n`), `changeBlinding` (default `0xabcdef1234567890n`), `changeOwnerPubkey` (default: same owner as input note). Computes `change_commitment` automatically.
- **`test/unshield.test.ts` — section titles**: corrected constraint labels in sections 3 (`Constraint 4` → `5`), 4 (`Constraint 5` → `6`), 5 (`Constraint 6` → `7`).
- **`test/unshield.test.ts` — test count**: 38 → 44.
- **Documentation updated**: `docs/circuits/unshield.md` (full rewrite of inputs, constraints, and usage examples), `docs/ARCHITECTURE.md` (constraint count, partial unshield description), `docs/guides/quick-start.md` (test count table).
- **`package.json`**: version bump `0.6.0` → `0.7.0`.
- **Artifacts recompiled** (`build/unshield_js/unshield.wasm`, `build/unshield.r1cs`, `keys/unshield_pk.zkey`, `build/verification_key_unshield.json`) to reflect the updated R1CS.

---

## [0.6.0] - 2026-04-22

### Added

- **`BabyPbk(spending_key)` constraint in `transfer.circom` and `unshield.circom`**: the prover must now demonstrate knowledge of the discrete logarithm of the `ownerPk` embedded in each input note commitment. This closes the formal soundness gap where `note_owner`/`input_owner_Ax` were unconstrained relative to `spending_key`.
- **Dummy input support in `transfer.circom`** (Zcash Sapling technique): when a user has only one note, the second input slot can carry `value = 0`. The circuit bypasses Merkle membership and nullifier derivation for dummy slots, while still enforcing value conservation.
- **Constraint 0 (`IsZero` detection)**: `IsZero(input_values[i])` determines `is_dummy[i].out` deterministically in R1CS. A prover cannot claim `is_dummy = 1` for a note with positive value — soundness is guaranteed by R1CS arithmetic.
- **Constraint 9 (`nullifiers[i] * is_dummy[i].out === 0`)**: forces the dummy nullifier to zero. A prover cannot supply a real nullifier in the dummy slot while bypassing Merkle checks.
- **`buildDummyInput()` test helper** (`test/transfer.test.ts`): constructs a valid 1-real + 1-dummy input with all-zero Merkle path for the dummy slot.
- **New test section 10 "Dummy note (Constraints 9 & 10)"** (7 tests):
    - Accepts 1 real note + dummy (value=0, nullifier=0).
    - Accepts corrupted Merkle path on dummy slot (path is ignored by the circuit).
    - Rejects dummy with non-zero nullifier (Constraint 9).
    - Accepts different fee values with dummy input.
    - Rejects wrong spending key for the real note in a 1-real+dummy scenario (Constraint 2 remains active for real inputs).
    - Rejects tampered Merkle root for the real note in a 1-real+dummy scenario (Constraint 1 remains active for real inputs).
    - Accepts dummy as `input[0]`, real as `input[1]` (symmetric position coverage).
- **`scripts/utils/lint-circom.sh`** (extended): two-phase linter for `.circom` files. Phase 1 — static checks: `pragma circom` presence, non-empty file, unconstrained assignments (`<--`). Phase 2 — compiler validation: invokes `circom 2.2.3` on all top-level circuits (`component main`) to validate syntax and semantics; skipped gracefully when `circom` is not in `PATH`.

### Changed

- **`transfer.circom` — EdDSA replaced by BabyPbk (net −~6,000 constraints)**:
    - Removed: `include "eddsaposeidon.circom"`, 10 private input signals (`input_owner_Ax[2]`, `input_owner_Ay[2]`, `input_sig_R8x[2]`, `input_sig_R8y[2]`, `input_sig_S[2]`), and 2× `EdDSAPoseidonVerifier` components (~6,000 constraints).
    - Added: `include "babyjub.circom"`, 2× `BabyPbk(spending_keys[i])` components (~5,000 constraints). The derived `Ax` is used in `NoteCommitment` (Constraint 1). Ownership proof is now the discrete log relation: the prover knows `sk` such that `BabyPbk(sk).Ax == ownerPk`.
    - **Constraint count**: 33,687.
    - **API change**: 10 fewer private inputs. Callers no longer provide EdDSA keypairs or signatures.
- **`unshield.circom` — `note_owner` removed, derived from `spending_key`**:
    - Removed: `signal input note_owner` (was the raw `ownerPk` x-coordinate, unconstrained relative to `spending_key`).
    - Added: `BabyPbk(spending_key)` component (Constraint 0); `key_derivation.Ax` is used in `NoteCommitment` instead of `note_owner`.
    - **Constraint count**: 16,033.
    - **API change**: 1 fewer private input (`note_owner`).
- **`test/transfer.test.ts`**:
    - Import: `buildEddsa` → `buildBabyjub`.
    - `alice`/`bob` keypairs: no longer derived from EdDSA key buffers; `Ax` now comes from `babyJub.mulPointEscalar(Base8, SK_DEFAULT)`.
    - Added `computeOwnerAx(sk)` helper.
    - Removed `sign()` helper.
    - `buildInput` and `buildDummyInput`: removed EdDSA fields; input note commitments computed with `computeOwnerAx(sk)`.
    - Section 3 renamed "Key derivation: BabyPbk(spending_key) → ownerPk (Constraint 3)"; tests updated to verify wrong spending_key causes Merkle failure (wrong Ax → wrong commitment → proof fails).
    - "Symmetric positions" test (section 10) updated to remove EdDSA fields.
- **`test/unshield.test.ts`**:
    - Import: added `buildBabyjub`.
    - Added `computeOwnerAx(sk)` helper.
    - `buildInput`: removed `owner` parameter; `owner` now derived from `spendingKey` via `computeOwnerAx`. Removed `note_owner` from returned object.
    - `recompile: false` → `recompile: true` (circuit changed).
    - "Tampered owner" test → "tampered spending_key → wrong Ax → commitment mismatch" (same coverage, correct for new API).
- **Constraint 1** (Merkle membership): changed from `merkle_verifiers[i].root === merkle_root` to `merkle_diffs[i] * (1 - is_dummy[i].out) === 0`. Dummy inputs are now exempt from Merkle membership.
- **Constraint 2** (Nullifier derivation): changed from `nullifier_computers[i].nullifier === nullifiers[i]` to `nullifier_diffs[i] * (1 - is_dummy[i].out) === 0`. Dummy inputs are now exempt from nullifier correctness check.
- **Constraint 10** (formerly Constraint 9 — distinct nullifiers): conditioned on both inputs being real: `IsZero(n0 - n1) * both_real === 0` where `both_real = (1 - is_dummy[0].out) * (1 - is_dummy[1].out)`. Correctly handles 1-real+1-dummy without false rejections.
- **Existing test "accepts max u128 fee"**: fixed to use `buildDummyInput` instead of `buildInput({value1: 0n})`. The old call activated `is_dummy[1]` via the circuit but passed a non-zero nullifier, violating Constraint 9 after it was introduced.
- **`package.json`**: version bump `0.5.1` → `0.6.0`.
- **Artifacts recompiled** (`build/transfer_js/transfer.wasm`, `build/transfer.r1cs`, `keys/transfer_pk.zkey`, `build/verification_key_transfer.json`) to reflect the updated R1CS.

### Removed

- **`scripts/generators/`** (entire directory): `generate_input.ts` (rewritten for BabyPbk before removal — EdDSA fields dropped, `ownerAx` derived from `Base8 * sk`, `asset_id` and `fee` added to output JSON), `generate_unshield_and_private_link_input.js` (updated for BabyPbk before removal — `note_owner` removed, `ownerAx` derived, `fee` added), `generate_disclosure_input.ts`, `generate_proof.ts`, `generate_disclosure_proof.ts`, `proof_wrapper.ts`, `eddsa_signer.ts`. Input generation and proof scripts are no longer part of the package — the test suite covers all circuit validation directly.
- **`scripts/e2e/`** (entire directory): `e2e-disclosure.ts`, `e2e-transfer.ts`.
- **`scripts/utils/check-artifacts.ts`** and **`scripts/utils/health-check.sh`**: removed. (`lint-circom.sh` and `generate-manifest.ts` were recreated and extended — see Added.)
- **`scripts/build/extract-vk.rs`**: standalone Rust script, unused by the build pipeline.
- **`scripts/build/generate-metadata.sh`**: not part of the build pipeline.
- **`scripts/README.md`**: removed with the utility scripts.
- **`Makefile`**: removed; all workflows use `pnpm` scripts directly. Reference removed from `.github/workflows/release.yml` path triggers.
- **`.husky/`** (pre-commit, commit-msg): Husky git hooks removed.
- **`package.json` scripts removed**: `build-all:manifest`, `gen-input:*`, `prove`, `prove:*`, `e2e:*`, `health`, `check-artifacts`, `check-artifacts:build`, `check-artifacts:cdn`, `check-artifacts:npm`, `prepare`.
- **`package.json` devDependencies removed**: `husky`, `lint-staged`.
- **`package.json` `lint-staged` block** removed.

### Security

- **Critical soundness gap closed**: `transfer.circom` and `unshield.circom` previously accepted any `(ownerPk, spending_key)` pair as long as the commitment was in the Merkle tree and the nullifier was correctly derived from `spending_key`. The absence of `BabyPbk` meant a prover could supply an unrelated `ownerPk` — impossible to exploit in practice (needs Merkle preimage) but a formal weakness. Now `ownerPk` is computed deterministically from `spending_key` inside the circuit.
- The new design matches TC Nova's key derivation model and is strictly stronger than the EdDSA approach: BabyPbk proves the discrete log relation directly, whereas EdDSA only proves knowledge of a signature (which is a weaker interactive proof of key ownership).
- Dummy nullifier binding (Constraint 9) closes a soundness gap where a prover could supply a real nullifier in the dummy slot to spend a note without a Merkle membership proof.
- The pallet (`pallet-shielded-pool`) rejects any `private_transfer` transaction where all nullifiers are zero (both inputs dummy), preventing free Merkle tree inflation. Enforced in both `validate_unsigned` (tx pool, `InvalidTransaction::Custom(2)`) and `execute` (extrinsic, `Error::InvalidAmount`).

---

## [0.5.1] - 2026-04-21

### Changed

- **Package manager migrated from npm to pnpm**:
    - `package.json`: added `packageManager` field (`pnpm@10.32.1`); replaced `npm run` with `pnpm run` in composite scripts (`compile`, `setup`, `build-all:manifest`); `clean` script now removes `pnpm-lock.yaml` instead of `package-lock.json`.
    - `pnpm-lock.yaml` added; `package-lock.json` removed.
- **CI pipeline** (`.github/workflows/ci.yml`):
    - Added `pnpm/action-setup@v4` step (no explicit `version`; resolved from `packageManager` in `package.json`) in both `build` and `security` jobs, before the Node.js setup step.
    - Changed `cache: 'npm'` → `cache: 'pnpm'` in `actions/setup-node`.
    - `npm ci` → `pnpm install --frozen-lockfile`.
    - All `npm run <script>` invocations → `pnpm run <script>`.
    - `npm audit` → `pnpm audit`.
- **Release pipeline** (`.github/workflows/release.yml`):
    - Added `pnpm/action-setup@v4` step (no explicit `version`; resolved from `packageManager` in `package.json`) before the Node.js setup step.
    - Changed `cache: "npm"` → `cache: "pnpm"` in `actions/setup-node`.
    - `npm ci` → `pnpm install --frozen-lockfile`.
    - All `npm run <script>` invocations → `pnpm run <script>`.
    - `npm publish` → `pnpm publish --no-git-checks`.
- **Dev dependency updates** (`package.json`):
    - `@types/chai`: `^4.3.11` → `^4.3.20`
    - `@types/mocha`: `^10.0.6` → `^10.0.10`
    - `@types/node`: `^20.10.0` → `^20.19.39`
    - `chai`: `^4.3.10` → `^4.5.0`
    - `ffjavascript`: `^0.2.60` → `^0.2.63`
    - `husky`: `^9.0.11` → `^9.1.7`
    - `lint-staged`: `^15.2.0` → `^15.5.2`
    - `mocha`: `^10.2.0` → `^10.8.2`
    - `prettier`: `^3.2.4` → `^3.8.3`
    - `snarkjs`: `^0.7.0` → `^0.7.6`
    - `typescript`: `^5.3.3` → `^5.9.3`

## [0.5.0] - 2026-04-12

### Added

- **Gasless fee signal in `unshield` and `transfer` circuits**:
    - `circuits/unshield.circom`: new public input `fee`. Constraint 1 changed from `note_value === amount` to `note_value === amount + fee`, allowing the validator (block author) to collect a fee from the note value without requiring a signed extrinsic.
    - `circuits/transfer.circom`: new public input `fee`. Conservation constraint changed from `input_sum === output_sum` to `input_sum === output_sum + fee`.
    - Both circuits expose `fee` in their `main` component public signals.
- **Fee range checks (defense-in-depth)**:
    - `circuits/unshield.circom` (Constraint 3): `Num2Bits(128)` on `fee` prevents field-wraparound attacks where an out-of-range fee could satisfy conservation while output values stay in u128.
    - `circuits/transfer.circom` (Constraint 6b): same `Num2Bits(128)` guard on `fee`.
- **Distinct nullifiers check in `transfer`** (Constraint 9):
    - Added `IsZero(nullifiers[0] - nullifiers[1]).out === 0` to prevent a prover from spending the same note twice in a single transaction. Without this constraint, setting `input[0] = input[1]` satisfies conservation and both pallet `Nullifiers::contains_key` checks pass before the first insert.
    - Added `comparators.circom` include.
- **New tests** (`test/unshield.test.ts`, `test/transfer.test.ts`):
    - `unshield`: fee = 0, fee > 0, realistic 0.001 ORB fee, fee = full note value, rejects old pre-gasless witness, rejects amount + fee > note_value, accepts/rejects u128 max fee, rejects fee = 2^128.
    - `transfer`: fee = 0, fee > 0, full-fee edge case, rejects pre-gasless balance, accepts/rejects u128 max fee, rejects fee = 2^128, accepts/rejects duplicate nullifiers.

### Changed

- **`circuits/unshield.circom`**: constraint numbering updated (3 through 7 shifted +1 due to new fee range check at position 3).
- **`circuits/transfer.circom`**: constraint 6 split into 6 (values) + 6b (fee); constraint 9 added for distinct nullifiers.
- **Artifacts recompiled** (`build/unshield_js/unshield.wasm`, `build/transfer_js/transfer.wasm`, `build/unshield.r1cs`, `build/transfer.r1cs`, `keys/unshield_pk.zkey`, `keys/transfer_pk.zkey`, `build/verification_key_unshield.json`, `build/verification_key_transfer.json`) to reflect new R1CS.
- **`manifest.json`** regenerated with updated SHA-256 checksums and `package_version: "0.5.0"`.
- **`package.json`**: version bump `0.4.4` → `0.5.0`.

### Security

- Fee range check (`Num2Bits(128)`) closes a field-arithmetic attack vector specific to the conservation constraint when `fee` is a public input.
- Distinct-nullifiers constraint closes a double-spend vector in `transfer` where a single note could be consumed twice in one transaction.

### Added

- **R1CS artifacts published to CDN**:
    - `release.yml`: copies `build/{circuit}.r1cs` files into `pkg/` before the Cloudflare R2 sync, making them available at `https://circuits.orbinum.io/v1/{circuit}.r1cs`.
    - `release.yml`: includes `{circuit}.r1cs` SHA-256 checksums in `release/checksums-{version}.txt`.
    - `scripts/utils/generate-manifest.ts`: added `r1cs` as a new `ArtifactKind`; reads `build/{circuit}.r1cs` and includes size + SHA-256 in the manifest when the file exists.
- **`private_link` circuit added to npm package** (`npm/`):
    - `npm/index.js`: `private_link` added to `CIRCUITS` array; `getCircuitPaths` now returns a `r1cs` path alongside `wasm`, `zkey`, `ark`, `verificationKey`.
    - `npm/index.d.ts`: `CircuitType` and `getCircuitPaths` signature extended with `"private_link"`; `CircuitPaths` interface includes new `r1cs: string` field.
    - `npm/package.json.template`: `*.r1cs` added to the `files` array so R1CS files are included in the published npm package.
    - `npm/README.md`: updated to document 4 circuits (20 artifacts total), `r1cs` artifact, corrected file sizes, and updated usage example to use `getCircuitPaths`.
- **`package.json`**: version bump `0.4.3` → `0.4.4`.

## [0.4.3] - 2026-03-08

### Added

- **`scripts/utils/generate-manifest.ts`**: canonical artifact manifest generator.
    - Generates `manifest.json` with per-circuit metadata.
    - Includes `active_version`, `supported_versions`, `vk_hash`, artifact size, and SHA-256.
    - Supports strict mode with `MANIFEST_REQUIRE_ALL=true` (fails if any required circuit artifact is missing).
- **`package.json` scripts**:
    - `manifest`: generates `manifest.json`.
    - `build-all:manifest`: runs full build then manifest generation.

### Changed

- **CI pipeline** (`.github/workflows/ci.yml`):
    - Enforces strict manifest generation after `build-all`.
    - Uploads `manifest.json` as CI artifact.
- **Release pipeline** (`.github/workflows/release.yml`):
    - Enforces strict manifest generation before packaging/publishing.
    - Includes `manifest.json` in checksum generation.
    - Copies `manifest.json` into npm package payload (`pkg/`) so CDN sync includes manifest.
- **`scripts/build/convert-to-ark.sh`**:
    - Fixed broken control flow / silent failure path.
    - Added strict shell mode (`set -euo pipefail`).
    - Added `rustup`/nightly checks with auto-install for nightly when missing.
    - Corrected usage output to display dynamic circuit names.
- **Documentation**:
    - Updated `README.md` with manifest generation section.
    - Added `docs/guides/pre-push-check-rapido.md` (quick pre-push checklist).
- **`package.json`**: version bump `0.4.2` → `0.4.3`.

## [0.4.2] - 2026-03-08

### Changed

- **`circuits/disclosure.circom`**: removed redundant `viewing_key` private input.
  Ownership is already proven implicitly by constraint 1 (commitment reconstruction);
  a separate `Poseidon(owner_pubkey)` signal provided no additional security.
  Updated `scripts/generators/generate_disclosure_input.ts` and
  `test/disclosure.test.ts` accordingly.
- **All circuits**: normalized all comments to English. Removed verbose section
  headers, Spanish text, and explanatory comments that restated the code.
  Comments now only document non-obvious logic.
- **`package.json`**: version bump `0.4.1` → `0.4.2`.

## [0.4.1] - 2026-03-07

### Added

- **`scripts/utils/check-artifacts.ts`** — herramienta de comparación de artifacts:
    - Compara SHA-256 de los artifacts locales contra CDN (`circuits.orbinum.io/v1`) y npm (`@orbinum/circuits`)
    - Detecta qué circuitos están desactualizados en cada fuente remota
    - Flag `--build` para compilar todo antes de comparar
    - Flags `--cdn-only` / `--npm-only` para consultas parciales
    - Exit code 1 si hay desactualizados (útil en CI)
    - Comandos: `npm run check-artifacts`, `check-artifacts:build`, `check-artifacts:cdn`, `check-artifacts:npm`

### Changed

- **package.json**: versión bump `0.4.0` → `0.4.1`.

## [0.4.0] - 2026-03-07

### Added

- **Circuit**: `private_link.circom` — nuevo circuito `PrivateLinkDispatch` para la operación `dispatch_as_private_link` en `pallet-account-mapping`.
    - 487 restricciones no lineales (dos llamadas Poseidon(2) + constraint cuadrático de call_hash)
    - 2 inputs públicos: `commitment` y `call_hash_fe`
    - 3 inputs privados: `chain_id_fe`, `address_fe`, `blinding_fe`
    - Esquema de commitment: `Poseidon2(Poseidon2(chain_id_fe, address_fe), blinding_fe)`
    - Fix de seguridad crítico: constraint cuadrático `call_hash_sq <== call_hash_fe * call_hash_fe` para sobrevivir a la simplificación lineal `--O1` y prevenir ataques de replay.
- **Scripts CI**: `compile:private-link`, `setup:private-link`, `full-build:private-link`, `convert:private-link` en `package.json`.
- **build-all.sh**: `private_link` añadido al array `CIRCUITS` — incluido en `npm run build-all`.
- **CI/CD** (`release.yml`): `private_link` incluido en todas las fases del pipeline de release:
    - Conversión `.zkey` → `.ark`
    - Generación de checksums
    - Empaquetado en los tres archivos tar (arkworks, snarkjs, verification-keys)
    - Paquete npm (`pkg/`)
- **Tests de circuito** (`test/private_link.test.ts`): 15 tests — validación del esquema Poseidon y restricciones R1CS.
- **VK embebida en runtime** (`primitives/zk-verifier/src/infrastructure/storage/verification_keys/private_link.rs`): VK Groth16/BN254 generada con el trusted setup de desarrollo, cargada en genesis.
- **Tests Rust de VK** (`orbinum-zk-verifier`): 5 tests que validan estructura de la VK (puntos en curva, round-trip de serialización, conteo de IC points).
- **`scripts/utils/check-artifacts.ts`** — herramienta de comparación de artifacts:
    - Compara SHA-256 de los artifacts locales contra CDN (`circuits.orbinum.io/v1`) y npm (`@orbinum/circuits`)
    - Detecta qué circuitos están desactualizados en cada fuente
    - Flag `--build` para compilar todo antes de comparar
    - Flags `--cdn-only` / `--npm-only` para consultas parciales
    - Exit code 1 si hay desactualizados (útil en CI)
    - Comandos: `npm run check-artifacts`, `check-artifacts:build`, `check-artifacts:cdn`, `check-artifacts:npm`

### Changed

- **package.json**: versión bump `0.3.1` → `0.4.0`.
- **CI/CD** (`release.yml`): workflow restringido a branches `main` y `develop`.

## [0.3.1] - 2026-02-18

### Added

- **CDN**: Automated deployment of circuit artifacts to Cloudflare R2 (`circuits.orbinum.io`) via CI/CD.

### Changed

- **Configuration**: Updated default circuit URL in `proof-generator` to point to the new global CDN.

## [0.3.0] - 2026-02-16

### Added

- **npm package distribution**: Added npm packaging assets under `npm/`:
    - `npm/package.json.template`
    - `npm/index.js`
    - `npm/index.d.ts`
    - `npm/README.md`
- **Release automation for npm**: Added release workflow steps to assemble `pkg/` and publish `@orbinum/circuits` to npm from CI.
- **Local package preparation target**: Added `make prepare-npm` to build a local `pkg/` package structure for validation before release.

### Changed

- **Release pipeline**: `.github/workflows/release.yml` now prepares npm-ready artifacts from circuit outputs (`.wasm`, `.zkey`, `.ark`, `verification_key_*.json`) and publishes with `NPM_TOKEN`.
- **Repository docs**: Updated `README.md` to document npm installation (`npm install @orbinum/circuits`) and package-based consumption.
- **Ignore rules**: Added `pkg/` to `.gitignore` because it is now a generated release/package directory.
- **Cleanup behavior**: Updated clean targets to include generated package/release working directories used for npm packaging.
- **Disclosure test behavior**: `test/disclosure.test.ts` now skips suites that require precompiled artifacts when `build/disclosure_js` is missing, instead of failing in environments where `make build` has not been run.
- **Commit hook scope**: `.husky/pre-commit` no longer runs `npm test`; it now executes only staged format/lint checks via `lint-staged`.

## [0.2.1] - 2026-02-09

### Changed

- **Release Format**: Restructured release assets into 3 separate archives for better usability
    - `orbinum-circuits-{version}.tar.gz`: Arkworks files (.wasm + .ark) for Rust/Substrate (~22 MB)
    - `orbinum-circuits-snarkjs-{version}.tar.gz`: snarkjs files (.zkey) for JavaScript/TypeScript (~24 MB)
    - `orbinum-verification-keys-{version}.tar.gz`: Verification keys (.json) for on-chain validation (~10 KB)
- All files are now extracted to the root directory (no nested folders) for easier integration
- Improved CI/CD workflow for reliable .ark file generation

## [0.2.0] - 2026-02-08

### Fixed

- **CRITICAL**: Increased value range check from u64 to u128 in `unshield.circom` and `transfer.circom`
    - Changed `Num2Bits(64)` to `Num2Bits(128)` to match runtime Balance type
    - Previous limit: ~18.4 ORB maximum per transaction
    - New limit: ~340 undecillion ORB (full u128 range)
    - Affects: Unshield and Private Transfer operations
    - Impact: Users can now transact with realistic amounts without artificial circuit limitations
    - **BREAKING CHANGE**: Requires recompilation of all circuits and regeneration of artifacts

## [0.1.0] - 2026-01-28

### Added

- Initial release of Orbinum Circuits
- Disclosure circuit with selective disclosure features
- Transfer circuit for private transactions
- Unshield circuit for multi-asset support
- Automated build pipeline (`build-all.sh`)
- Comprehensive test suite (86 tests)
- Performance benchmarking framework
- End-to-end testing scripts
- Circuit compilation scripts
- Trusted setup automation
- Powers of Tau download and caching
- Witness generation utilities
- Proof generation and verification
- TypeScript support for all scripts
- Mocha/Chai testing framework
- Circom 2.0 compatibility

### Circuit Details

#### Disclosure Circuit

- Constraints: 1,584
- Inputs: 8 private, 4 public
- Features: Selective disclosure with 4 modes
- Merkle depth: 20 levels
- Hash function: Poseidon

#### Transfer Circuit

- Private asset transfers
- Note commitment scheme
- Merkle proof verification
- EdDSA signature support

#### Unshield Circuit

- Multi-asset unshielding
- Value range proofs
- Asset type validation

### Documentation

- README with quick start guide
- Circuit-specific documentation
- Build pipeline documentation
- Testing guidelines
- Benchmarking instructions

### Infrastructure

- Node.js ≥18.0.0 requirement
- TypeScript 5.3+ support
- Git ignore configuration
- npm package configuration
- CircomLib integration

## Release Notes

### Version 0.1.0

This is the initial release of Orbinum Circuits, extracted from the main Orbinum blockchain repository to facilitate independent development and release management.

**Key Features**:

- Production-ready circuit definitions
- Automated build and setup process
- Comprehensive testing framework
- Performance benchmarking

**Security Notice**:
⚠️ This release uses a **development trusted setup** only. The proving keys generated are **NOT SECURE** for production use. A multi-party trusted setup ceremony with 50+ participants is required before deploying to mainnet.

**Integration**:

- **Wallet CLI**: Use WASM + .zkey files for client-side proof generation
- **Substrate Runtime**: Verifying keys to be embedded in `primitives/zk-verifier/src/vk/`

**System Requirements**:

- Node.js ≥18.0.0
- circom compiler 2.2.3+
- snarkjs 0.7.0+
- 4GB RAM minimum (8GB recommended)
- 2GB free disk space

**Known Limitations**:

- Single-circuit proving (no proof composition yet)
- Development trusted setup only
- No formal verification performed
- Limited constraint optimization

**Next Steps**:

1. Professional security audit (Q2 2026)
2. Multi-party trusted setup ceremony (Q3 2026)
3. Constraint optimization (~20% reduction target)
4. PLONK proof system support
5. Recursive proof composition

---

## Version History

| Version | Release Date | Breaking Changes | Notes         |
| ------- | ------------ | ---------------- | ------------- |
| 0.1.0   | 2026-01-28   | N/A (initial)    | First release |

## Upgrade Guide

### From: None (Initial Release)

### To: 0.1.0

This is the initial release. No upgrade needed.

---

## Note on Contributions

This project is not currently accepting external contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for more information.
