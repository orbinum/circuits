# Orbinum Circuits - Architecture

## Project Overview

Orbinum Circuits is a Zero-Knowledge proof system for privacy-preserving blockchain transactions. The project uses Circom for circuit definition and Groth16 for proof generation.

## Directory Structure

```
orbinum-circuits/
├── .github/                    # GitHub configuration
│   ├── workflows/              # CI/CD pipelines
│   ├── ISSUE_TEMPLATE/         # Issue templates
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── PRE_COMMIT.md          # Pre-commit documentation
│
├── circuits/                   # Circom circuit definitions
│   ├── core/                   # Core circuit components
│   │   ├── merkle_tree.circom
│   │   ├── note.circom
│   │   └── poseidon_wrapper.circom
│   ├── disclosure.circom       # Selective disclosure
│   ├── transfer.circom         # Private transfers
│   └── unshield.circom        # Asset unshielding
│
├── scripts/                    # Automation scripts
│   ├── build/                  # Build pipeline
│   │   ├── compile.sh
│   │   ├── setup.sh
│   │   ├── full-pipeline.sh
│   │   ├── convert-to-ark.sh
│   │   └── generate-metadata.sh
│   ├── generators/             # Input/proof generators
│   │   ├── generate_disclosure_input.ts
│   │   ├── generate_disclosure_proof.ts
│   │   ├── generate_input.ts
│   │   ├── generate_proof.ts
│   │   ├── proof_wrapper.ts
│   │   └── eddsa_signer.ts
│   ├── e2e/                    # End-to-end tests
│   │   ├── e2e-disclosure.ts
│   │   └── e2e-transfer.ts
│   ├── utils/                  # Utilities
│   │   ├── health-check.sh
│   │   └── lint-circom.sh
│   ├── build-all.sh           # Main build script
│   └── README.md              # Scripts documentation
│
├── test/                       # Test suite
│   ├── circuits/               # Circuit-specific tests
│   │   ├── disclosure.test.ts
│   │   ├── transfer.test.ts
│   │   └── unshield.test.ts
│   ├── components/             # Component tests
│   │   ├── merkle_tree.test.ts
│   │   ├── note.test.ts
│   │   └── poseidon_wrapper.test.ts
│   └── helpers/                # Test utilities
│
├── benches/                    # Performance benchmarks
│   ├── disclosure.bench.ts
│   ├── transfer.bench.ts
│   └── utils.ts
│
├── build/                      # Build artifacts (gitignored)
│   ├── *_js/                   # WASM witness calculators
│   ├── *.r1cs                  # Constraint systems
│   └── verification_key_*.json # Verifying keys
│
├── keys/                       # Cryptographic keys (gitignored)
│   └── *_pk.zkey              # Proving keys
│
├── docs/                       # Documentation
│   ├── architecture/           # Architecture docs
│   ├── circuits/               # Circuit specifications
│   └── guides/                 # User guides
│
├── types/                      # TypeScript type definitions
│
└── config/                     # Configuration files
    ├── circuits.config.json   # Circuit parameters
    └── build.config.json      # Build configuration

```

## Component Architecture

### 1. **Circuits Layer** (`circuits/`)

**Purpose**: Define zero-knowledge circuits in Circom

**Organization**:

- `core/`: Reusable circuit components (merkle trees, cryptographic primitives)
- Root level: Main application circuits (disclosure, transfer, unshield)

**Dependencies**:

- `circomlib` for standard cryptographic primitives
- Custom `poseidon_wrapper` for hash functions

### 2. **Build System** (`scripts/build/`)

**Purpose**: Compile circuits and generate cryptographic keys

**Components**:

- `compile.sh`: Circom compilation (circom → R1CS + WASM)
- `setup.sh`: Trusted setup (Powers of Tau → proving/verifying keys)
- `full-pipeline.sh`: Complete build automation
- `convert-to-ark.sh`: Convert keys to arkworks format

**Workflow**:

```
.circom → compile → .r1cs + .wasm → setup → .zkey + vk.json
```

### 3. **Testing Framework** (`test/`)

**Purpose**: Comprehensive circuit validation

**Test Levels**:

1. **Unit Tests** (`components/`): Individual circuit components
2. **Integration Tests** (`circuits/`): Complete circuits
3. **End-to-End Tests** (`scripts/e2e/`): Full proof lifecycle

**Tools**:

- `circom_tester`: Circuit testing framework
- `mocha` + `chai`: Test runner and assertions
- `snarkjs`: Proof generation and verification

### 4. **Benchmarking** (`benches/`)

**Purpose**: Performance measurement and optimization

**Metrics**:

- Witness generation time
- Proof generation time
- Verification time
- Memory usage
- Throughput (operations/second)

### 5. **Code Generators** (`scripts/generators/`)

**Purpose**: Generate inputs and proofs programmatically

**Generators**:

- `generate_input.ts`: Create valid circuit inputs
- `generate_proof.ts`: Generate ZK proofs
- `proof_wrapper.ts`: Proof serialization/deserialization

### 6. **Documentation** (`docs/`)

**Purpose**: Comprehensive project documentation

**Structure**:

- **Architecture**: System design and component interactions
- **Circuits**: Circuit specifications and constraint analysis
- **Guides**: Setup, development, and deployment guides

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

| File        | Purpose               | Size   | Location      |
| ----------- | --------------------- | ------ | ------------- |
| `*.r1cs`    | Constraint system     | ~200KB | `build/`      |
| `*.sym`     | Symbols for debugging | ~130KB | `build/`      |
| `*.wasm`    | Witness calculator    | ~2MB   | `build/*_js/` |
| `*_pk.zkey` | Proving key           | ~700KB | `keys/`       |
| `vk_*.json` | Verifying key         | ~3KB   | `build/`      |

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
npm install

# 2. Build circuits
npm run build-all

# 3. Run tests
npm test

# 4. Run benchmarks
npm run bench

# 5. Format code
npm run format
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
        "maxAssets": 8
    },
    "transfer": {
        "merkleDepth": 20,
        "inputNotes": 2,
        "outputNotes": 2
    }
}
```

### Build Configuration (`config/build.config.json`)

```json
{
    "optimization": "O1",
    "ptauSize": 16,
    "parallelBuilds": true
}
```

## Performance Targets

| Circuit    | Constraints | Proof Time | Verify Time |
| ---------- | ----------- | ---------- | ----------- |
| Disclosure | ~1,600      | <150ms     | <5ms        |
| Transfer   | ~10,000     | <500ms     | <5ms        |
| Unshield   | ~5,000      | <250ms     | <5ms        |

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
