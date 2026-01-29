# Orbinum Circuits

Zero-Knowledge circuits for Orbinum privacy blockchain using Circom and Groth16.

## Quick Start

Build everything from scratch with one command:

```bash
npm run build-all
```

This automatically:

- Installs dependencies
- Compiles circuits (disclosure.circom → R1CS + WASM)
- Downloads Powers of Tau (72MB, one-time)
- Generates cryptographic keys (proving + verifying keys)
- Converts to compatible formats

**Output:**

- `build/disclosure_js/disclosure.wasm` (2.1MB) - Witness calculator
- `keys/disclosure_pk.zkey` (689KB) - Proving key
- `build/verification_key_disclosure.json` (3.4KB) - Verifying key

## Testing

### Run All Tests

```bash
npm test
```

**Test Suites:**

- `disclosure.test.ts` - Selective disclosure circuit
- `transfer.test.ts` - Private transfer logic
- `unshield.test.ts` - Multi-asset support
- `merkle_tree.test.ts` - Merkle proof verification
- `note.test.ts` - Note commitment schemes
- `poseidon_*.test.ts` - Hash function compatibility

**Expected:** ~86 tests passing in 7 seconds

### Run Specific Test

```bash
npm test -- --grep "disclosure"
```

## Benchmarks

### Prerequisites

Generate test inputs first:

```bash
npm run gen-input:disclosure
```

This creates 4 test scenarios:

- `reveal_nothing` - Full privacy
- `reveal_value_only` - Amount visible
- `reveal_value_and_asset` - Amount + asset type visible
- `reveal_all` - Complete disclosure

### Run Benchmarks

```bash
# Disclosure circuit
npm run bench:disclosure

# Transfer circuit (coming soon)
npm run bench:transfer

# All circuits
npm run bench
```

**Metrics measured:**

- Witness generation time
- Proof generation time
- Proof verification time
- Memory usage
- Throughput (ops/sec)

**Results saved to:** `build/benchmark_results_*.json`

### Example Output

```
📊 Benchmarking Proof Generation (10 iterations)...
  Proof Generation:
    Average:    101.29 ms
    Min:        97.62 ms
    Max:        109.43 ms
    Throughput: 9.87 ops/sec
```

## End-to-End Workflows

Complete automated workflows from compilation to proof generation.

### Disclosure Circuit

```bash
npm run e2e:disclosure
```

**What it does:**

1. Compiles circuit
2. Sets up keys
3. Generates test inputs (4 scenarios)
4. Creates proofs for all scenarios
5. Verifies all proofs

**Generated artifacts:**

- 4 input files: `build/disclosure_input_*.json`
- 4 proof files: `build/proof_disclosure_*.json`
- 4 public signals: `build/public_disclosure_*.json`

### Transfer Circuit

```bash
npm run e2e:transfer
```

## Development Workflow

### Clean Build from Scratch

```bash
# Remove all generated files
rm -rf keys/ build/ node_modules/

# Rebuild everything
npm run build-all
```

### Individual Build Steps

```bash
# Step 1: Compile circuit
npm run compile:disclosure

# Step 2: Generate keys (requires compilation)
npm run setup:disclosure

# Step 3: Convert to compatible format (optional)
npm run convert:discord

# Or run all steps together
npm run full-build:disclosure
```

### Generate WASM for Rust (Witness Calculator)

**Why is this needed?**

The `fp-encrypted-memo` primitive can use WASM to calculate the complete circuit witness (~740 wires) without reimplementing all Circom logic in Rust. This ensures:

- ✅ **Accuracy**: Executes the exact circuit logic
- ✅ **Maintainability**: Updates automatically when circuit is recompiled
- ✅ **Consistency**: Avoids bugs from code duplication
- ✅ **Completeness**: Generates all intermediate wires needed

**From circuits/circuits/ directory:**

```bash
# Compile disclosure.circom to WASM
circom disclosure.circom --wasm --output ../build/
```

**Generated file:**

- `build/disclosure_js/disclosure.wasm` (~2.1MB)

**Usage in Rust:**

```rust
// With feature flag: wasm-witness
let wasm_bytes = std::fs::read("circuits/build/disclosure_js/disclosure.wasm")?;
let witness = calculate_witness_wasm(&wasm_bytes, &inputs, &signals)?;
```

**Note:** WASM is also generated automatically with `npm run build-all`.

### Generate Test Inputs

```bash
# Disclosure circuit (4 scenarios)
npm run gen-input:disclosure

# Transfer circuit
npm run gen-input:transfer
```

### Generate Proofs

```bash
# Disclosure proofs
npm run prove:disclosure

# Transfer proofs
npm run prove:transfer
```

## Circuit Specifications

### Disclosure Circuit

**Purpose:** Selective disclosure of encrypted memo fields

**Statistics:**

- Constraints: 1,584
- Private inputs: 8
- Public inputs: 4
- Wires: 1,586

**Features:**

- Commitment verification
- Selective field revelation
- Viewing key authentication
- Zero-knowledge privacy

## Project Structure

```
circuits/
├── circuits/          # Circom source files
│   └── disclosure.circom
├── build/            # Compiled artifacts
│   ├── disclosure_js/
│   │   └── disclosure.wasm
│   └── verification_key_*.json
├── keys/             # Cryptographic keys
│   ├── disclosure_pk.zkey
│   └── disclosure_pk.ark
├── test/             # Test suites
├── benches/          # Performance benchmarks
├── scripts/          # Build and generation scripts
│   ├── build/        # Compilation scripts
│   ├── generators/   # Input/proof generators
│   └── e2e-*.ts      # End-to-end workflows
└── package.json
```

## Requirements

- **Node.js** >= 18
- **npm** >= 9
- **circom** >= 2.2.0
- **snarkjs** >= 0.7.0

All requirements are checked automatically by build scripts.

## Troubleshooting

### "Missing disclosure input files"

Run input generator first:

```bash
npm run gen-input:disclosure
```

### "Powers of Tau download failed"

Check internet connection. The script will retry with fallback URLs automatically.

### "Compilation failed"

Ensure circom is installed:

```bash
circom --version  # Should be >= 2.2.0
```

### Clean and rebuild

```bash
rm -rf keys/ build/ node_modules/
npm run build-all
```

## Performance Reference

**Development Machine (M2 MacBook Air):**

- Full build: ~25 seconds (including PoT download)
- Subsequent builds: ~10 seconds
- Proof generation: ~100ms
- Proof verification: ~5ms

## Contributing

**Note**: This project is currently not accepting external contributions. The repository is open for transparency and reference purposes.

## License

Apache 2.0 / GPL3 - See LICENSE files
