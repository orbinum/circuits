# Orbinum Circuits - Architecture

## Project Overview

Orbinum Circuits is a Zero-Knowledge proof system for privacy-preserving blockchain transactions. The project uses Circom for circuit definition and Groth16 for proof generation.

## Directory Structure

```
orbinum-circuits/
├── .github/                    # GitHub configuration
│   ├── workflows/              # CI pipelines
│   │   └── ci.yml              # Build, test, security audit (no publishing)
│   ├── ISSUE_TEMPLATE/         # Issue templates
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── PRE_COMMIT.md          # Pre-commit documentation
│
├── circuits/                   # Circom circuit definitions (flat)
│   ├── value_proof.circom      # Note formation proof (relay-fee claiming)
│   ├── merkle_tree.circom      # Merkle tree component
│   ├── note.circom             # Note commitment
│   ├── poseidon_wrapper.circom # Poseidon hash wrapper
│   ├── transfer.circom         # Private transfers (2-in/2-out, supports dummy inputs)
│   └── unshield.circom         # Asset unshielding
│
├── scripts/                    # Automation scripts
│   ├── build/                  # Build pipeline
│   │   ├── compile.sh
│   │   ├── setup.sh
│   │   ├── full-pipeline.sh
│   │   ├── convert-to-ark.sh
│   │   ├── convert-to-ark.rs   # Rust script (.zkey → .ark)
│   │   ├── extract-vk.rs       # Rust script (extract verifying key)
│   │   └── generate-metadata.sh
│   ├── e2e/                    # End-to-end tests
│   │   └── e2e-transfer.ts
│   ├── utils/                  # Utilities
│   │   ├── check-artifacts.ts
│   │   ├── generate-manifest.ts
│   │   ├── health-check.sh
│   │   └── lint-circom.sh
│   ├── build-all.sh            # Main build script
│   └── README.md
│
├── test/                       # Test suite (flat)
│   ├── value_proof.test.ts
│   ├── merkle_tree.test.ts
│   ├── note.test.ts
│   ├── poseidon_compat.test.ts
│   ├── poseidon_wrapper.test.ts
│   ├── transfer.test.ts
│   ├── unshield.test.ts
│   └── test-utils.ts           # Shared test helpers
│
├── benches/                    # Performance benchmarks
│   ├── run-all.bench.ts
│   ├── transfer.bench.ts
│   ├── types.ts
│   └── utils.ts
│
├── npm/                        # npm package template
│   ├── index.js
│   ├── index.d.ts
│   ├── package.json.template
│   └── README.md
│
├── build/                      # Build artifacts (gitignored)
│   ├── *_js/                   # WASM witness calculators
│   ├── *.r1cs                  # Constraint systems
│   ├── *.sym                   # Debug symbols
│   └── verification_key_*.json # Verifying keys
│
├── keys/                       # Cryptographic keys (gitignored)
│   ├── *_pk.zkey               # Proving keys (snarkjs)
│   └── *_pk.ark                # Proving keys (arkworks)
│
├── dist/                       # TypeScript compilation output
│
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md
│   ├── circuits/               # Circuit specifications
│   │   ├── value_proof.md
│   │   ├── merkle-tree.md
│   │   ├── note.md
│   │   ├── poseidon-wrapper.md
│   │   ├── transfer.md
│   │   └── unshield.md
│   └── guides/                 # User guides
│       ├── quick-start.md
│       ├── arkworks-integration.md
│       └── pre-push-check-rapido.md
│
├── types/                      # TypeScript type definitions
│   └── circom_tester.d.ts
│
├── config/                     # Configuration files
│   ├── circuits.config.json    # Circuit parameters
│   └── build.config.json       # Build configuration
│
├── manifest.json               # Published artifact manifest
├── package.json
├── pnpm-lock.yaml
└── tsconfig.json

```

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

- `compile.sh`: Circom compilation (circom → R1CS + WASM)
- `setup.sh`: Trusted setup (Powers of Tau → proving/verifying keys)
- `full-pipeline.sh`: Complete build automation
- `convert-to-ark.sh` / `convert-to-ark.rs`: Convert `.zkey` to `.ark` (arkworks format)
- `extract-vk.rs`: Extract verifying key from `.zkey` via Rust script
- `generate-metadata.sh`: Generate circuit metadata

**Workflow**:

```
.circom → compile → .r1cs + .wasm → setup → .zkey + vk.json
```

### 3. **Testing Framework** (`test/`)

**Purpose**: Comprehensive circuit validation

**Test files** (flat structure):

- `value_proof.test.ts`, `transfer.test.ts`, `unshield.test.ts`: Application circuit tests
- `merkle_tree.test.ts`, `note.test.ts`, `poseidon_wrapper.test.ts`, `poseidon_compat.test.ts`: Component tests
- `test-utils.ts`: Shared test helpers

**End-to-End Tests** (`scripts/e2e/`): Full proof lifecycle

**Tools**:

- `circom_tester`: Circuit testing framework
- `mocha` + `chai`: Test runner and assertions
- `snarkjs`: Proof generation and verification

### 4. **Benchmarking** (`benches/`)

**Purpose**: Performance measurement and optimization

**Files**:

- `run-all.bench.ts`: Runs all benchmarks sequentially
- `transfer.bench.ts`: Per-circuit benchmarks
- `types.ts`, `utils.ts`: Shared benchmark helpers

**Metrics**:

- Witness generation time
- Proof generation time
- Verification time
- Memory usage
- Throughput (operations/second)

### 5. **npm Package** (`npm/`)

**Purpose**: Distributable npm package template for `@orbinum/circuits`

- `index.js` / `index.d.ts`: Package entry point and TypeScript types
- `package.json.template`: Version-stamped during release
- Published manually via `scripts/release/release.sh` to npm (see [RELEASE.md](./RELEASE.md))

### 7. **Documentation** (`docs/`)

**Purpose**: Comprehensive project documentation

**Structure**:

- **ARCHITECTURE.md**: System design and component interactions (this file)
- **circuits/**: Specifications for value_proof, transfer, unshield, note, merkle-tree, poseidon-wrapper
- **guides/**: Quick start, arkworks integration, pre-push checks

## Data Flow

### Proof Generation Flow

```
1. Witness Calculation
   └─> build/*_js/*.wasm
        └─> Execute circuit logic
        └─> Generate witness (.wtns)

3. Proof Generation
   └─> snarkjs + keys/*_pk.zkey
        └─> Groth16 proving algorithm
        └─> Output: proof.json + public.json

4. Verification
   └─> snarkjs + build/verification_key_*.json
        └─> Verify proof validity
        └─> Output: boolean (valid/invalid)
```

### Build Pipeline Flow

```
1. Dependency Check
   └─> Verify circom, snarkjs installed
   └─> Check node version ≥18

2. Circuit Compilation
   └─> Parse .circom files
   └─> Generate R1CS constraints
   └─> Generate WASM witness calculator

3. Trusted Setup
   └─> Download Powers of Tau (once)
   └─> Circuit-specific setup
   └─> Generate proving key
   └─> Export verifying key

4. Validation
   └─> Verify setup integrity
   └─> Run test suite
   └─> Generate benchmarks
```

## Build Artifacts

### Generated Files

| File                      | Purpose                    | Location      |
| ------------------------- | -------------------------- | ------------- |
| `*.r1cs`                  | Constraint system          | `build/`      |
| `*.sym`                   | Symbols for debugging      | `build/`      |
| `*_js/*.wasm`             | Witness calculator         | `build/*_js/` |
| `*_pk.zkey`               | Proving key (snarkjs)      | `keys/`       |
| `*_pk.ark`                | Proving key (arkworks)     | `keys/`       |
| `verification_key_*.json` | Verifying key              | `build/`      |
| `manifest.json`           | Artifact manifest + hashes | root          |

### Artifact Lifecycle

- **Development**: Generated locally, excluded from git
- **CI**: Rebuilt for validation only — never published (nondeterministic keys)
- **Releases**: Manual, from the developer's machine (`scripts/release/release.sh`); published as npm package and GitHub release assets. Published artifacts are immutable.
- **Integration**: Downloaded by consuming applications, sha256-verified against `manifest.json`

## Security Considerations

### Trusted Setup

- **Development**: Single-party setup (insecure, for testing only)
- **Production**: Multi-party ceremony required (50+ participants)
- **Verification**: All contributions are cryptographically verifiable

### Key Management

- **Proving Keys**: Large files, stored separately from repository
- **Verifying Keys**: Small, embedded in on-chain pallets
- **Powers of Tau**: Downloaded from trusted ceremonies (Hermez)

### Circuit Auditing

1. **Constraint Analysis**: Verify constraint count and complexity
2. **Soundness Check**: Ensure no invalid proofs can be generated
3. **Completeness Check**: Ensure all valid inputs can be proven
4. **Determinism**: Verify circuits produce consistent outputs

## Development Workflow

### Local Development

```bash
# 1. Clone and install
git clone <repo>
pnpm install

# 2. Build circuits
pnpm run build-all

# 3. Run tests
pnpm test

# 4. Run benchmarks
pnpm run bench

# 5. Format code
pnpm run format
```

### Adding New Circuits

1. Create circuit file in `circuits/`
2. Add compilation script in `package.json`
3. Create test file in `test/circuits/`
4. Add benchmark in `benches/`
5. Update documentation

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

## Configuration Management

### Circuit Parameters (`config/circuits.config.json`)

```json
{
    "value_proof": {
        "constraints": 300
    },
    "transfer": {
        "merkleDepth": 20,
        "inputNotes": 2,
        "outputNotes": 2,
        "maxAssets": 8
    },
    "unshield": {
        "merkleDepth": 20,
        "maxAssets": 8
    }
}
```

### Build Configuration (`config/build.config.json`)

```json
{
    "compiler": {
        "version": "2.2.3",
        "optimization": "O1",
        "outputFormats": ["r1cs", "wasm", "sym"]
    },
    "setup": {
        "ptauSize": 16,
        "ceremony": { "type": "development" }
    }
}
```

## Performance Targets

| Circuit      | Constraints | Proof Time | Verify Time |
| ------------ | ----------- | ---------- | ----------- |
| Value Proof  | ~300        | <50ms      | <5ms        |
| Transfer     | 33,687      | <3s        | <15ms       |
| Unshield     | 16,903      | <1s        | <15ms       |
| Private Link | 487         | <100ms     | <5ms        |

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
