# Orbinum Circuits - Architecture

## Project Overview

Orbinum Circuits is a Zero-Knowledge proof system for privacy-preserving blockchain transactions. The project uses Circom for circuit definition and Groth16 for proof generation.

## Directory Structure

```
circuits/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/ci.yml         # Four jobs: lint, test, vk-hash, security
│
├── circuits/                    # Circom sources (flat)
│   ├── poseidon_wrapper.circom  # Poseidon2 / Poseidon4 — the primitive layer
│   ├── note.circom              # NoteCommitment, Nullifier
│   ├── merkle_tree.circom       # Selector, MerkleTreeVerifier
│   ├── value_proof.circom       # Note formation proof (relay-fee claiming)
│   ├── transfer.circom          # Private transfer, 2-in/2-out, dummy inputs
│   └── unshield.circom          # Asset unshielding
│
├── scripts/
│   ├── lib/                     # Shared by every script
│   │   ├── circuits.ts          # The circuit list and their public-signal counts
│   │   ├── paths.ts             # Repository layout, resolved once
│   │   ├── log.ts               # Console output and colour
│   │   ├── run.ts               # Process execution and tool presence
│   │   └── manifest.ts          # Reading and traversing manifest.json
│   ├── build/
│   │   ├── compile.ts           # circom → .r1cs, .wasm, .sym
│   │   ├── setup.sh             # Groth16 trusted setup (ptau, contribute, beacon)
│   │   ├── pack-proving-key.sh  # .zkey → .ark v2, via groth16-proofs
│   │   └── full-pipeline.ts     # The three above, for one circuit
│   ├── release/
│   │   ├── release.sh           # Manual release: pack, tag, publish
│   │   ├── verify-artifacts.ts  # Fail-closed check against the manifest
│   │   └── restore-artifacts.ts # Re-download drifted artifacts from npm
│   ├── utils/
│   │   ├── generate-manifest.ts # Emits manifest.json with canonical vk_hash
│   │   ├── lint-circom.ts       # Static checks + a real compile
│   │   └── make-fixture.ts      # Deterministic per-circuit test fixtures
│   └── build-all.ts             # full-pipeline over every circuit
│
├── test/
│   ├── helpers/
│   │   ├── circuit-inputs.ts    # The note cryptography in JavaScript
│   │   └── artifacts.ts         # The artifact guard and strict mode
│   ├── test-utils.ts            # Temp-circuit cleanup
│   ├── poseidon_wrapper.test.ts # Component tests (compile a temp circuit)
│   ├── note.test.ts
│   ├── merkle_tree.test.ts
│   ├── poseidon_compat.test.ts  # Cross-implementation Poseidon vectors
│   ├── value_proof.test.ts      # Circuit tests (need the compiled wasm)
│   ├── transfer.test.ts
│   ├── unshield.test.ts
│   ├── metadata.test.ts         # Arity and constraint counts, three sources
│   ├── manifest_schema.test.ts  # The committed manifest's shape
│   └── manifest_vk_hash.test.ts # vk_hash == blake2_256(packed VK)
│
├── fixtures/                    # Deterministic inputs; witnesses are generated
│   ├── unshield.input.json
│   ├── transfer.input.json
│   └── value_proof.input.json
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── RELEASE.md
│   ├── circuits/                # One document per circuit and component
│   └── guides/
│
├── npm/                         # What gets published: entry point and template
│   ├── index.js
│   ├── index.d.ts
│   ├── package.json.template
│   └── README.md
│
├── types/circom_tester.d.ts
├── manifest.json                # Published artifact manifest (generated)
├── eslint.config.mjs
├── .mocharc.json
├── .prettierrc
├── package.json
└── tsconfig.json
```

Generated directories, none of them committed: `build/` (circom output),
`keys/` (proving and verifying keys), `ptau/` (the powers-of-tau file),
`pkg/` and `release/` (assembled at publish time).

## Component Architecture

### 1. **Circuits Layer** (`circuits/`)

**Purpose**: Define zero-knowledge circuits in Circom

**Organization** (flat — all `.circom` files at root level):

- `merkle_tree.circom`, `note.circom`, `poseidon_wrapper.circom`: Reusable components
- `value_proof.circom`, `transfer.circom`, `unshield.circom`: Application circuits

`transfer.circom` implements a 2-in/2-out scheme with **dummy input support**: when a user has only one note, the second input slot carries `value = 0` and bypasses Merkle membership and nullifier derivation (Zcash Sapling technique). Ownership is proven via `BabyPbk(spending_key)` — no EdDSA signatures required. The dummy nullifier is forced to zero by the circuit (Constraint 9). The pallet rejects transactions where both nullifiers are zero (anti-spam).

`unshield.circom` supports **partial withdrawal via a change note**: `note_value === amount + fee + change_value`. When `change_value == 0` (total unshield) `change_commitment` must be `0`. When `change_value > 0` (partial unshield) `change_commitment` must equal `NoteCommitment(change_value, asset_id, change_owner_pubkey, change_blinding)` and the pallet inserts it into the Merkle tree. The circuit has 7 public inputs and 16,903 constraints.

**Dependencies**:

- `circomlib` for standard cryptographic primitives
- Custom `poseidon_wrapper` for hash functions

### 2. **Build System** (`scripts/build/`)

**Purpose**: Compile circuits and generate cryptographic keys

**Components**:

- `compile.ts`: Circom compilation (circom → R1CS + WASM + symbols)
- `setup.sh`: Trusted setup (Powers of Tau → proving/verifying keys)
- `full-pipeline.ts`: The three phases above, for one circuit
- `pack-proving-key.sh`: Convert `.zkey` to `.ark` v2, via the `pack-proving-key` binary from the sibling `groth16-proofs` checkout

**Workflow**:

```
.circom → compile → .r1cs + .wasm → setup → .zkey + vk.json
```

### 3. **Testing Framework** (`test/`)

**Purpose**: Comprehensive circuit validation

**Test files** (flat structure):

- `value_proof.test.ts`, `transfer.test.ts`, `unshield.test.ts`: Application circuit tests
- `merkle_tree.test.ts`, `note.test.ts`, `poseidon_wrapper.test.ts`, `poseidon_compat.test.ts`: Component tests
- `metadata.test.ts`: Public-signal arity and constraint counts, checked against three independent sources
- `manifest_schema.test.ts`, `manifest_vk_hash.test.ts`: The committed manifest and its canonical `vk_hash`
- `helpers/circuit-inputs.ts`: The note cryptography in JavaScript, shared by every suite
- `helpers/artifacts.ts`: The artifact guard — see `CIRCUITS_REQUIRE_ARTIFACTS` below
- `test-utils.ts`: Temp-circuit cleanup

**Strict mode**: circuit suites skip themselves when the compiled wasm is
absent, so a fresh checkout is green. `CIRCUITS_REQUIRE_ARTIFACTS=1`
(`pnpm test:strict`, which is what CI runs) turns that absence into a failure —
a suite that skips everything is otherwise indistinguishable from one that
passes everything.

End-to-end proof generation and verification lives downstream, in
[`groth16-proofs`](https://github.com/orbinum/groth16-proofs), which consumes
these artifacts.

**Tools**:

- `circom_tester`: Circuit testing framework
- `mocha` + `chai`: Test runner and assertions
- `snarkjs`: Proof generation and verification

### Pre-commit Hooks

- **Format Check**: Prettier on TypeScript/JavaScript/JSON/Markdown
- **Lint**: Basic validation on Circom files
- **Tests**: All test suites must pass
- **Commit Message**: Conventional Commits format

## CI & Releases

### Continuous Integration (`ci.yml`)

**Triggers**: Push to main/develop, pull requests

**Steps**:

1. Install dependencies + circom
2. Lint (prettier, circom)
3. Compile all circuits (`build-all` — throwaway keys, validates circuit logic)
4. Run test suite (includes committed-manifest schema validation)

CI never publishes and never regenerates `manifest.json`: zkey/VK setup is
nondeterministic, so a CI rebuild would produce VKs that don't match what is
registered on-chain.

### Release (manual)

No CD pipeline. Releases run locally via `scripts/release/release.sh`, which
fail-closed verifies every artifact's sha256 against the committed
`manifest.json` before publishing to npm and GitHub releases.
Full flow and rationale: [RELEASE.md](./RELEASE.md).

## Circuit metadata

There is no configuration file. A circuit's parameters live in the circom source
that defines them, and the numbers that describe a circuit — its public-signal
count above all — live in `scripts/lib/circuits.ts`:

```ts
export const PUBLIC_SIGNALS: Record<CircuitName, number> = {
    value_proof: 4,
    transfer: 7,
    unshield: 7,
};
```

`test/metadata.test.ts` requires that table, the verifying key's `nPublic`, and
the compiled `.r1cs` to agree. Three independent sources, so none can drift
alone.

This replaced `config/circuits.config.json`, which no code read. It claimed 300
constraints for `value_proof`, which has 1151 — an error that survived because
nothing checked it and nothing depended on it. A metadata file nobody reads is a
trap, not documentation.

## Performance Targets

| Circuit     | Constraints | Proof Time | Verify Time |
| ----------- | ----------- | ---------- | ----------- |
| Value Proof | 1,151       | <50ms      | <5ms        |
| Transfer    | 33,687      | <3s        | <15ms       |
| Unshield    | 16,903      | <1s        | <15ms       |

## Versioning Strategy

- **Semantic Versioning**: MAJOR.MINOR.PATCH
- **Circuit Changes**: MAJOR version bump
- **Key Generation**: MAJOR version bump (breaks compatibility)
- **Bug Fixes**: PATCH version bump
- **New Features**: MINOR version bump

## Integration Points

### Wallet CLI

- Imports: WASM witness calculator + proving key
- Usage: Client-side proof generation
- Size: ~3MB total

### Substrate Runtime

- Imports: Verifying key (embedded in source)
- Usage: On-chain proof verification
- Size: ~3KB per circuit

## Future Enhancements

1. **Circuit Optimization**: Reduce constraint count by 20%
2. **Parallel Builds**: Speed up compilation
3. **PLONK Support**: Alternative proof system
4. **Recursive Proofs**: Proof composition
5. **Automated Auditing**: Static analysis tools
