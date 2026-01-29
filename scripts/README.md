# Circuit Scripts

Automation scripts for building circuits and generating proofs.

## Directory Structure

```
scripts/
├── build-all.sh              # Complete automated build
├── build/                    # Build pipeline
│   ├── compile.sh           # Compile circuit to R1CS + WASM
│   ├── setup.sh             # Generate proving/verifying keys
│   ├── full-pipeline.sh     # Run compile + setup + convert
│   ├── convert-to-ark.sh    # Convert keys to arkworks format
│   └── generate-metadata.sh # Extract circuit metadata
├── generators/               # Input/proof generators
│   ├── generate_disclosure_input.ts    # Generate disclosure test inputs
│   ├── generate_disclosure_proof.ts    # Generate disclosure proofs
│   ├── generate_input.ts               # Generate transfer inputs
│   ├── generate_proof.ts               # Generate proofs (universal)
│   ├── eddsa_signer.ts                 # EdDSA signature utilities
│   └── proof_wrapper.ts                # Proof generation wrapper
├── e2e/                      # End-to-end tests
│   ├── e2e-disclosure.ts    # E2E disclosure workflow
│   └── e2e-transfer.ts      # E2E transfer workflow
├── utils/                    # Utilities
│   ├── health-check.sh      # Repository health check
│   └── lint-circom.sh       # Circom linter
└── README.md                 # This file
```

## Main Scripts

### build-all.sh

Complete automated build from scratch.

**Usage:**

```bash
npm run build-all
```

**What it does:**

- Installs dependencies (if needed)
- Compiles disclosure circuit
- Downloads Powers of Tau (one-time, 72MB)
- Generates proving and verifying keys
- Converts to compatible format

**Time:** ~25 seconds (first run), ~10 seconds (subsequent)

## End-to-End Tests

### e2e/e2e-disclosure.ts

End-to-end workflow for disclosure circuit.

**Usage:**

```bash
npm run e2e:disclosure
```

**What it does:**

1. Compiles circuit
2. Sets up keys
3. Generates 4 test input scenarios
4. Creates proofs for all scenarios
5. Verifies all proofs

**Generates:**

- 4 input files: `build/disclosure_input_*.json`
- 4 proof files: `build/proof_disclosure_*.json`
- 4 public signals: `build/public_disclosure_*.json`

### e2e/e2e-transfer.ts

End-to-end workflow for transfer circuit.

**Usage:**

```bash
npm run e2e:transfer
```

Similar to disclosure workflow but for transfer circuit.

## Build Scripts

### compile.sh

Compiles Circom circuit to R1CS and WASM.

**Usage:**

```bash
npm run compile:disclosure
# or
bash scripts/build/compile.sh disclosure
```

**Generates:**

- `build/disclosure.r1cs` (208 KB) - Constraint system
- `build/disclosure_js/disclosure.wasm` (2.1 MB) - Witness calculator
- `build/disclosure.sym` (129 KB) - Debug symbols

### setup.sh

Generates cryptographic keys via trusted setup.

**Usage:**

```bash
npm run setup:disclosure
# or
bash scripts/build/setup.sh disclosure
```

**Generates:**

- `keys/disclosure_pk.zkey` (689 KB) - Proving key
- `build/verification_key_disclosure.json` (3.4 KB) - Verifying key
- `ptau/pot16_final.ptau` (72 MB, cached) - Powers of Tau

### convert-to-ark.sh

Converts proving key from snarkjs format to arkworks format using ark-circom CLI.

**Usage:**

```bash
npm run convert:disclosure
# or
bash scripts/build/convert-to-ark.sh disclosure
```

**Requires:** `ark-circom` installed globally

```bash
cargo install ark-circom
```

**Generates:**

- `keys/disclosure_pk.ark` (689 KB) - Real arkworks format

**Purpose:**

- Required for `fp-encrypted-memo` (Rust proof generation)
- wallet-cli using Rust bindings needs this
- TypeScript/snarkjs can use `.zkey` directly

### full-pipeline.sh

Runs complete build pipeline (compile + setup + convert).

**Usage:**

```bash
npm run full-build:disclosure
# or
bash scripts/build/full-pipeline.sh disclosure
```

Equivalent to running compile, setup, and convert in sequence.

### generate-metadata.sh

Extracts circuit metadata for documentation.

**Usage:**

```bash
bash scripts/build/generate-metadata.sh
```

**Generates:**

- `build/disclosure_metadata.json`
- Circuit constraint count, wire count, signal information

## Generator Scripts

### generate_disclosure_input.ts

Creates test input files for disclosure circuit.

**Usage:**

```bash
npm run gen-input:disclosure
# or
npx ts-node scripts/generators/generate_disclosure_input.ts
```

**Generates 4 scenarios:**

- `disclosure_input_reveal_nothing.json` - Full privacy
- `disclosure_input_reveal_value_only.json` - Amount visible
- `disclosure_input_reveal_value_and_asset.json` - Amount + asset visible
- `disclosure_input_reveal_all.json` - Complete disclosure

### generate_disclosure_proof.ts

Generates proofs from disclosure input files.

**Usage:**

```bash
npm run prove:disclosure
# or
npx ts-node scripts/generators/generate_disclosure_proof.ts
```

### generate_input.ts

Creates test input files for transfer circuit.

**Usage:**

```bash
npm run gen-input:transfer
# or
npx ts-node scripts/generators/generate_input.ts
```

### generate_proof.ts

Universal proof generator (works with any circuit).

**Usage:**

```bash
npm run prove:transfer
# or
npx ts-node scripts/generators/generate_proof.ts
```

## Complete Workflow Example

### From Zero to Proof

```bash
# 1. Clean start
cd circuits
rm -rf keys/ build/ node_modules/

# 2. Build everything (ONE COMMAND)
npm run build-all

# 3. Generate test inputs
npm run gen-input:disclosure

# 4. Run tests
npm test

# 5. Generate proofs
npm run prove:disclosure

# 6. Run benchmarks
npm run bench:disclosure

# 7. Complete E2E workflow
npm run e2e:disclosure
```

### Individual Circuit Build

```bash
# Compile only
npm run compile:disclosure

# Setup keys only (requires compilation first)
npm run setup:disclosure

# Convert format (requires setup first)
npm run convert:disclosure

# Or all steps together
npm run full-build:disclosure
```

### Development Cycle

```bash
# 1. Make changes to circuit
vim circuits/disclosure.circom

# 2. Rebuild
npm run full-build:disclosure

# 3. Test changes
npm test

# 4. Verify proofs still work
npm run prove:disclosure
```

## Quick Commands

| Task             | Command                                    |
| ---------------- | ------------------------------------------ |
| Build everything | `npm run build-all`                        |
| Compile circuit  | `npm run compile:disclosure`               |
| Generate keys    | `npm run setup:disclosure`                 |
| Full build       | `npm run full-build:disclosure`            |
| Generate inputs  | `npm run gen-input:disclosure`             |
| Generate proofs  | `npm run prove:disclosure`                 |
| Run tests        | `npm test`                                 |
| Run benchmarks   | `npm run bench:disclosure`                 |
| E2E workflow     | `npm run e2e:disclosure`                   |
| Clean rebuild    | `rm -rf keys/ build/ && npm run build-all` |

## Output Files

After complete build:

```
circuits/
├── ptau/
│   └── pot16_final.ptau              # 72 MB - Powers of Tau (cached)
├── build/
│   ├── disclosure.r1cs               # 208 KB - Constraints
│   ├── disclosure.sym                # 129 KB - Debug symbols
│   ├── verification_key_disclosure.json  # 3.4 KB - Verifying key
│   ├── disclosure_js/
│   │   └── disclosure.wasm           # 2.1 MB - Witness calculator
│   ├── disclosure_input_*.json       # Test inputs (4 files)
│   ├── proof_disclosure_*.json       # Generated proofs (4 files)
│   └── benchmark_results_*.json      # Benchmark results
└── keys/
    ├── disclosure_pk.zkey            # 689 KB - Proving key
    └── disclosure_pk.ark             # 689 KB - Compatible copy
```

## Requirements

- **Node.js** >= 18
- **npm** >= 9
- **circom** >= 2.2.0
- **snarkjs** >= 0.7.0
- **ark-circom** (optional, for .ark conversion)

Build scripts check requirements automatically.

## Utilities

### utils/health-check.sh

Validates repository health and dependencies.

**Usage:**

```bash
npm run health
```

**Checks:**

- Node.js and Circom versions
- Required files and directories
- Git hooks installation
- Code formatting
- Test suite status

### utils/lint-circom.sh

Lints Circom circuit files for common issues.

**Usage:**

```bash
npm run lint:circom
```

**Validates:**

- Circuit syntax
- Naming conventions
- Signal declarations
- Component usage
