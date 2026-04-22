# Orbinum Circuits

[![npm version](https://img.shields.io/npm/v/@orbinum/circuits.svg)](https://www.npmjs.com/package/@orbinum/circuits)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

Zero-Knowledge circuits for Orbinum privacy blockchain.

**Stack**: Circom 2.0 · Groth16 · BN254 · Poseidon (circomlib) · BabyPbk key derivation (BabyJubJub) · snarkjs + arkworks

**Privacy model**: UTXO-based note scheme, 2-in / 2-out with dummy input support (Zcash Sapling technique). Multi-asset (`asset_id` per note). Gasless fee embedded in the circuit proof. Merkle tree depth 20 (up to 1,048,576 notes). All value ranges enforced as u128 (matches Substrate `Balance`).

## Installation

### Using npm (Pre-built Artifacts)

```bash
npm install @orbinum/circuits
```

This installs pre-compiled circuit artifacts ready to use. See [npm package documentation](./docs/npm-publishing.md).

### Building from Source

```bash
git clone https://github.com/orbinum/circuits
cd circuits
pnpm run build-all
```

## Quick Start

Build everything from scratch with one command:

```bash
pnpm run build-all
```

This automatically:

- Installs dependencies
- Compiles circuits (disclosure.circom → R1CS + WASM)
- Downloads Powers of Tau (72MB, one-time)
- Generates cryptographic keys (proving + verifying keys)
- Converts to compatible formats
- Generates `manifest.json` with SHA-256 hashes for artifacts (when using `pnpm run build-all:manifest`)

### Generate Artifact Manifest (NPM/CDN sync)

```bash
pnpm run manifest
```

This creates `manifest.json` at repo root with:

- package version metadata
- active/supported version per circuit
- SHA-256 + size for `.wasm`, `.zkey`, `.ark` (if available)
- `vk_hash` derived from `verification_key_<circuit>.json`

**Output:**

- `build/disclosure_js/disclosure.wasm` (2.1MB) - Witness calculator
- `keys/disclosure_pk.zkey` (689KB) - Proving key
- `build/verification_key_disclosure.json` (3.4KB) - Verifying key

## Using with Rust/Substrate

The circuits can be used in Rust/Substrate projects in two ways:

### Option 1: .ark file (Optimized, Recommended)

Download the pre-built `.ark` file from releases. This is a serialized arkworks `ProvingKey` that loads 2-3x faster than parsing `.zkey` files.

**Setup:**

```toml
[dependencies]
ark-bn254 = "0.5.0"
ark-groth16 = "0.5.0"
ark-serialize = "0.5.0"
```

**Usage:**

```rust
use ark_bn254::Bn254;
use ark_groth16::{Groth16, ProvingKey};
use ark_serialize::CanonicalDeserialize;
use std::fs::File;

// Load .ark file (fast)
let mut ark_file = File::open("keys/disclosure_pk.ark")?;
let proving_key = ProvingKey::<Bn254>::deserialize_compressed(&mut ark_file)?;

// Generate proof
let proof = Groth16::<Bn254>::prove(&proving_key, circuit, &mut rng)?;
```

### Option 2: .zkey file (Direct, with ark-circom)

The `.zkey` files work directly with the [ark-circom](https://github.com/arkworks-rs/circom-compat) library - no conversion needed.

**Setup:**

```toml
[dependencies]
ark-circom = "0.5.0"
ark-bn254 = "0.5.0"
ark-groth16 = "0.5.0"
```

**Usage:**

```rust
use ark_circom::{read_zkey, CircomConfig, CircomBuilder};
use ark_bn254::Bn254;
use ark_groth16::Groth16;
use std::fs::File;

// Read .zkey file directly
let mut zkey_file = File::open("keys/disclosure_pk.zkey")?;
let (proving_key, matrices) = read_zkey(&mut zkey_file)?;

// Configure circuit with WASM
let cfg = CircomConfig::<Bn254>::new(
    "build/disclosure_js/disclosure.wasm",
    "build/disclosure.r1cs"
)?;

// Build circuit with inputs
let mut builder = CircomBuilder::new(cfg);
builder.push_input("note_value", 1000);
builder.push_input("note_asset_id", 42);
// ... add more inputs

// Generate proof
let circom = builder.build()?;
let proof = Groth16::<Bn254>::prove(&proving_key, circom, &mut rng)?;
```

### Convert .zkey to .ark locally

If you need to generate the `.ark` file yourself:

```bash
# Using the Rust script
cargo +nightly -Zscript scripts/build/convert-to-ark.rs \
  keys/disclosure_pk.zkey \
  keys/disclosure_pk.ark

# Or via pnpm
pnpm run convert:disclosure
```

### Download Release Artifacts

Get pre-built circuits from [GitHub Releases](../../releases):

```bash
# Download latest release
wget https://github.com/orb-labs/circuits/releases/latest/download/disclosure-circuit-v*.tar.gz

# Extract files
tar -xzf disclosure-circuit-v*.tar.gz

# Use in your Rust project
cp keys/disclosure_pk.zkey /path/to/your/rust/project/
cp build/disclosure_js/disclosure.wasm /path/to/your/rust/project/
```

## Testing

### Run All Tests

```bash
pnpm test
```

**Test Suites:**

- `disclosure.test.ts` - Selective disclosure circuit
- `transfer.test.ts` - Private transfer logic
- `unshield.test.ts` - Multi-asset support
- `merkle_tree.test.ts` - Merkle proof verification
- `note.test.ts` - Note commitment schemes
- `poseidon_*.test.ts` - Hash function compatibility

**Expected:** 129 tests passing in ~45 seconds

### Run Specific Test

```bash
pnpm test -- --grep "disclosure"
```

## Benchmarks

### Prerequisites

Generate test inputs first:

```bash
pnpm run gen-input:disclosure
```

This creates 4 test scenarios:

- `reveal_nothing` - Full privacy
- `reveal_value_only` - Amount visible
- `reveal_value_and_asset` - Amount + asset type visible
- `reveal_all` - Complete disclosure

### Run Benchmarks

```bash
# Disclosure circuit
pnpm run bench:disclosure

# Transfer circuit (coming soon)
pnpm run bench:transfer

# All circuits
pnpm run bench
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
pnpm run e2e:disclosure
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
pnpm run e2e:transfer
```

## Development Workflow

### Clean Build from Scratch

```bash
# Remove all generated files
rm -rf keys/ build/ node_modules/

# Rebuild everything
pnpm run build-all
```

### Individual Build Steps

```bash
# Step 1: Compile circuit
pnpm run compile:disclosure

# Step 2: Generate keys (requires compilation)
pnpm run setup:disclosure

# Step 3: Convert to compatible format (optional)
pnpm run convert:discord

# Or run all steps together
pnpm run full-build:disclosure
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

**Note:** WASM is also generated automatically with `pnpm run build-all`.

### Generate Test Inputs

```bash
# Disclosure circuit (4 scenarios)
pnpm run gen-input:disclosure

# Transfer circuit
pnpm run gen-input:transfer
```

### Generate Proofs

```bash
# Disclosure proofs
pnpm run prove:disclosure

# Transfer proofs
pnpm run prove:transfer
```

## Circuit Specifications

### Transfer Circuit — `circuits/transfer.circom`

**Purpose:** Private token transfer: 2 input notes → 2 output notes

**Statistics:**

- Constraints: 33,687
- Private inputs: 9 scalars + 40 Merkle path elements (2×20)
- Public inputs: 7 (`merkle_root`, `nullifiers[2]`, `commitments[2]`, `asset_id`, `fee`)
- Tree depth: 20

**Features:**

- Merkle membership proof (real inputs only; dummy inputs exempt via `IsZero`)
- BabyPbk key derivation: `BabyPbk(spending_key)` derives `ownerPk (Ax)` inside the circuit, proving discrete log ownership — replaces EdDSA, saves ~6,000 constraints (Constraint 3)
- Nullifier derivation: `Poseidon(commitment, spending_key)` (real inputs only)
- Dummy input support: `input_values[i] == 0` bypasses Merkle, nullifier, and ownership checks
- Dummy nullifier binding: `nullifiers[i] * is_dummy[i].out === 0` (Constraint 9)
- Distinct nullifiers when both inputs are real: `IsZero(n0-n1) * both_real === 0` (Constraint 10)
- Value conservation: `Σinput = Σoutput + fee` (fee is a public signal, cryptographically bound to the proof)
- u128 range checks on all input values, output values, and fee
- Asset ID consistency across all 4 notes; public `asset_id` bound to note asset IDs

### Unshield Circuit — `circuits/unshield.circom`

**Purpose:** Withdraw a private note to a public account

**Statistics:**

- Constraints: 16,033
- Private inputs: 5 scalars + 20 Merkle path elements
- Public inputs: 6 (`merkle_root`, `nullifier`, `amount`, `recipient`, `asset_id`, `fee`)
- Tree depth: 20

**Features:**

- Note value conservation: `note_value === amount + fee`
- Merkle membership proof for the input note
- Nullifier derivation: `Poseidon(commitment, spending_key)`
- u128 range checks on `note_value` and `fee`
- Asset ID binding between private note and public `asset_id`
- `recipient` is a public signal (validated non-zero in the pallet)

### Disclosure Circuit — `circuits/disclosure.circom`

**Purpose:** Selective on-chain disclosure of note fields without revealing the spending key

**Statistics:**

- Constraints: 1,584
- Private inputs: 7 (`value`, `asset_id`, `owner_pubkey`, `blinding`, `disclose_value`, `disclose_asset_id`, `disclose_owner`)
- Public inputs: 4 (`commitment`, `revealed_value`, `revealed_asset_id`, `revealed_owner_hash`)

**Features:**

- Commitment preimage proof: `commitment === Poseidon(value, asset_id, owner_pubkey, blinding)`
- Selective field revelation controlled by boolean masks (`disclose_*`)
- Owner revealed as `Poseidon(owner_pubkey)` instead of raw pubkey (privacy-preserving)
- Boolean mask constraints: `disclose_* * (disclose_* - 1) === 0`

### Private Link Circuit — `circuits/private_link.circom`

**Purpose:** Prove knowledge of an external wallet address linked to an on-chain commitment, without revealing the address

**Statistics:**

- Constraints: 487
- Private inputs: 3 (`chain_id_fe`, `address_fe`, `blinding_fe`)
- Public inputs: 2 (`commitment`, `call_hash_fe`)

**Features:**

- Commitment scheme: `Poseidon(Poseidon(chain_id_fe, address_fe), blinding_fe)`
- Proof bound to a specific call via `call_hash_sq <== call_hash_fe * call_hash_fe` (quadratic constraint; survives `--O1` simplification, prevents replay across different calls)

## Security Properties

The following properties are enforced at the circuit level (R1CS constraints). They hold for any honest or adversarial prover — soundness is guaranteed by the Groth16 argument.

**Dummy input soundness**: `IsZero(input_values[i])` is deterministic in R1CS. A prover cannot set `is_dummy.out = 1` without `input_values[i]` being provably zero. Technique from Zcash Sapling.

**Dummy nullifier binding** (Constraint 9 in `transfer`): `nullifiers[i] * is_dummy[i].out === 0`. A prover cannot supply a real nullifier in a dummy slot while bypassing Merkle membership and ownership checks.

**Distinct nullifiers when both real** (Constraint 10 in `transfer`): `IsZero(nullifiers[0] - nullifiers[1]).out * both_real === 0`. Prevents spending the same note twice in one transaction. Conditioned on `both_real` so a 1-real + 1-dummy input is accepted without false rejection.

**Merkle path index binary** (in `merkle_tree.circom`): `path_index[i] * (path_index[i] - 1) === 0`. Prevents malformed Merkle proofs with non-binary path indices.

**Fee binding in `transfer` and `unshield`**: `fee` is a public input included in the conservation constraint. The pallet cannot alter the fee after the proof is generated — any change invalidates the proof.

**Quadratic call hash in `private_link`**: The quadratic `call_hash_sq` constraint survives linear simplification (`--O1`). Without it, `call_hash_fe` would have a zero coefficient in `gamma_abc`, making the proof replayable across different calls.

**Anti-spam (pallet, two layers)**: `pallet-shielded-pool` rejects any `private_transfer` where all nullifiers are zero (both inputs dummy) — (1) in `validate_unsigned` (tx pool, `InvalidTransaction::Custom(2)`) and (2) in `execute` (`Error::InvalidAmount`). Prevents free Merkle tree inflation without a valid spend.

## Project Structure

```
circuits/
├── circuits/                  # Circom source files
│   ├── transfer.circom        # 2-in/2-out private transfer (33,687 constraints)
│   ├── unshield.circom        # Private → public withdrawal (16,033 constraints)
│   ├── disclosure.circom      # Selective field disclosure (1,584 constraints)
│   ├── private_link.circom    # Cross-chain identity link (487 constraints)
│   ├── note.circom            # NoteCommitment + Nullifier templates
│   ├── merkle_tree.circom     # MerkleTreeVerifier template
│   └── poseidon_wrapper.circom
├── build/                     # Compiled artifacts
│   ├── transfer_js/transfer.wasm
│   ├── disclosure_js/disclosure.wasm
│   └── verification_key_*.json
├── keys/                      # Cryptographic keys
│   ├── *_pk.zkey              # snarkjs proving keys
│   └── *_pk.ark               # arkworks proving keys (serialized)
├── test/                      # Test suites (129 tests)
├── benches/                   # Performance benchmarks
├── scripts/                   # Build and generation scripts
│   ├── build/                 # Compilation scripts
│   ├── generators/            # Input/proof generators
│   └── e2e-*.ts               # End-to-end workflows
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
pnpm run gen-input:disclosure
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
pnpm run build-all
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
