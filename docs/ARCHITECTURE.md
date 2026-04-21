# Orbinum Circuits - Architecture

## Project Overview

Orbinum Circuits is a Zero-Knowledge proof system for privacy-preserving blockchain transactions. The project uses Circom for circuit definition and Groth16 for proof generation.

## Directory Structure

```
orbinum-circuits/
├── .github/                    # GitHub configuration
│   ├── workflows/              # CI/CD pipelines
│   │   ├── ci.yml              # Build, test, security audit
│   │   └── release.yml         # Release & publish
│   ├── ISSUE_TEMPLATE/         # Issue templates
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── PRE_COMMIT.md          # Pre-commit documentation
│
├── circuits/                   # Circom circuit definitions (flat)
│   ├── disclosure.circom       # Selective disclosure
│   ├── merkle_tree.circom      # Merkle tree component
│   ├── note.circom             # Note commitment
│   ├── poseidon_wrapper.circom # Poseidon hash wrapper
│   ├── private_link.circom     # Private note linking
│   ├── transfer.circom         # Private transfers
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
│   ├── generators/             # Input/proof generators
│   │   ├── generate_disclosure_input.ts
│   │   ├── generate_disclosure_proof.ts
│   │   ├── generate_input.ts
│   │   ├── generate_proof.ts
│   │   ├── generate_unshield_and_private_link_input.js
│   │   ├── proof_wrapper.ts
│   │   └── eddsa_signer.ts
│   ├── e2e/                    # End-to-end tests
│   │   ├── e2e-disclosure.ts
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
│   ├── disclosure.test.ts
│   ├── merkle_tree.test.ts
│   ├── note.test.ts
│   ├── poseidon_compat.test.ts
│   ├── poseidon_wrapper.test.ts
│   ├── private_link.test.ts
│   ├── transfer.test.ts
│   ├── unshield.test.ts
│   └── test-utils.ts           # Shared test helpers
│
├── benches/                    # Performance benchmarks
│   ├── run-all.bench.ts
│   ├── disclosure.bench.ts
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
│   │   ├── disclosure.md
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
- `disclosure.circom`, `transfer.circom`, `unshield.circom`, `private_link.circom`: Application circuits

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

- `disclosure.test.ts`, `transfer.test.ts`, `unshield.test.ts`, `private_link.test.ts`: Application circuit tests
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
- `disclosure.bench.ts`, `transfer.bench.ts`: Per-circuit benchmarks
- `types.ts`, `utils.ts`: Shared benchmark helpers

**Metrics**:

- Witness generation time
- Proof generation time
- Verification time
- Memory usage
- Throughput (operations/second)

### 5. **Code Generators** (`scripts/generators/`)

**Purpose**: Generate inputs and proofs programmatically

**Generators**:

- `generate_input.ts`: Create valid transfer circuit inputs
- `generate_disclosure_input.ts`: Create disclosure circuit inputs
- `generate_proof.ts` / `generate_disclosure_proof.ts`: Generate ZK proofs
- `generate_unshield_and_private_link_input.js`: Inputs for unshield + private link
- `proof_wrapper.ts`: Proof serialization/deserialization
- `eddsa_signer.ts`: EdDSA signature helper

### 6. **npm Package** (`npm/`)

**Purpose**: Distributable npm package template for `@orbinum/circuits`

- `index.js` / `index.d.ts`: Package entry point and TypeScript types
- `package.json.template`: Version-stamped during release
- Published to npm registry and Cloudflare R2 on each release

### 7. **Documentation** (`docs/`)

**Purpose**: Comprehensive project documentation

**Structure**:

- **ARCHITECTURE.md**: System design and component interactions (this file)
- **circuits/**: Specifications for disclosure, transfer, unshield, note, merkle-tree, poseidon-wrapper
- **guides/**: Quick start, arkworks integration, pre-push checks

## Data Flow

### Proof Generation Flow

```
1. Input Generation
   └─> scripts/generators/generate_input.ts
        └─> Validate parameters
        └─> Create circuit inputs (JSON)

2. Witness Calculation
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
- **CI/CD**: Generated during builds, cached
- **Releases**: Published as GitHub release assets
- **Integration**: Downloaded by consuming applications

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

## CI/CD Pipeline

### Continuous Integration

**Triggers**: Push to main, pull requests

**Steps**:

1. Install dependencies
2. Compile all circuits
3. Run test suite
4. Generate benchmarks
5. Upload artifacts

### Continuous Deployment

**Triggers**: Git tags (v*.*.\*)

**Steps**:

1. Build release artifacts
2. Run full test suite
3. Generate documentation
4. Create GitHub release
5. Publish artifacts

## Configuration Management

### Circuit Parameters (`config/circuits.config.json`)

```json
{
    "disclosure": {
        "merkleDepth": 20,
        "maxAssets": 8,
        "constraints": 1584
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
    },
    "private_link": {
        "merkleDepth": 20
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
| Disclosure   | ~1,584      | <150ms     | <5ms        |
| Transfer     | ~32,000     | <500ms     | <5ms        |
| Unshield     | ~5,000      | <250ms     | <5ms        |
| Private Link | ~5,000      | <250ms     | <5ms        |

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
