# Orbinum Circuits

[![npm version](https://img.shields.io/npm/v/@orbinum/circuits.svg)](https://www.npmjs.com/package/@orbinum/circuits)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

Zero-Knowledge circuits for Orbinum privacy blockchain.

**Stack**: Circom 2.0 · Groth16 · BN254 · Poseidon (circomlib) · BabyPbk key derivation (BabyJubJub) · snarkjs + arkworks

**Privacy model**: UTXO-based note scheme, 2-in / 2-out with dummy input support (Zcash Sapling technique). Partial unshield with change note (returns unspent value to the pool without a prior Transfer step). Multi-asset (`asset_id` per note). Gasless fee embedded in the circuit proof. Merkle tree depth 20 (up to 1,048,576 notes). All value ranges enforced as u128 (matches Substrate `Balance`).

## Installation

### Using npm (Pre-built Artifacts)

```bash
npm install @orbinum/circuits
```

This installs pre-compiled circuit artifacts ready to use. See [release documentation](./docs/RELEASE.md).

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
- Compiles circuits (value_proof.circom → R1CS + WASM)
- Downloads Powers of Tau (72MB, one-time)
- Generates cryptographic keys (proving + verifying keys)
- Converts to compatible formats

### Generate Artifact Manifest (NPM/CDN sync)

```bash
pnpm run manifest
```

This creates `manifest.json` at repo root with:

- package version metadata
- per-circuit `active_version`, `supported_versions[]`, and a `versions{}` map keyed by version
- SHA-256 + size for `.wasm`, `.zkey`, `.ark` (if available), per version
- `vk_hash` per version — the canonical **on-chain** hash: `blake2_256` of the arkworks-compressed verifying key, byte-for-byte identical to what the chain stores. This is what lets the SDK cross-check a note's circuit version against the chain's VK before spending.

#### Multi-version manifest (VK rotation)

A single `manifest.json` can carry **multiple verifying keys per circuit** at once. When you rotate a circuit, the old version stays `supported` (so notes created with it remain spendable) while the new version becomes `active`:

```bash
# Append a new version onto the existing manifest
ROTATE_CIRCUIT=transfer ROTATE_VERSION=2 pnpm run manifest
```

- Prior versions are reused verbatim; the new one is appended.
- `supported_versions` grows; `active_version` becomes the new version.
- Artifacts are version-suffixed (`transfer_v2_pk.zkey`, …) so they don't collide in a flat served directory.
- Without the env vars, the generator produces a single-version manifest as before.

A new version's key material must genuinely differ from the old one. The trusted setup is parametrized for this:

```bash
SETUP_ENTROPY=... SETUP_BEACON=... SETUP_BEACON_ITERS=... pnpm run setup:transfer
```

Defaults reproduce the original v1 setup byte-for-byte.

**Output:**

- `build/value_proof_js/value_proof.wasm` (<1MB) - Witness calculator
- `keys/value_proof_pk.zkey` (<1MB) - Proving key
- `build/verification_key_value_proof.json` (3.4KB) - Verifying key

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
let mut ark_file = File::open("keys/transfer_pk.ark")?;
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
let mut zkey_file = File::open("keys/transfer_pk.zkey")?;
let (proving_key, matrices) = read_zkey(&mut zkey_file)?;

// Configure circuit with WASM
let cfg = CircomConfig::<Bn254>::new(
    "build/transfer_js/transfer.wasm",
    "build/transfer.r1cs"
)?;;

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
  keys/value_proof_pk.zkey \
  keys/value_proof_pk.ark

# Or via pnpm
pnpm run convert:value-proof
```

### Download Release Artifacts

Get pre-built circuits from [GitHub Releases](../../releases):

```bash
# Download latest release
wget https://github.com/orb-labs/circuits/releases/latest/download/orbinum-circuits-v*.tar.gz

# Extract files
tar -xzf orbinum-circuits-v*.tar.gz

# Use in your Rust project
cp value_proof_pk.zkey /path/to/your/rust/project/
cp value_proof.wasm /path/to/your/rust/project/
```

## Testing

### Run All Tests

```bash
pnpm test
```

**Test Suites:**

- `value_proof.test.ts` - Relay fee value proof (16 tests)
- `transfer.test.ts` - Private transfer logic
- `unshield.test.ts` - Multi-asset support
- `merkle_tree.test.ts` - Merkle proof verification
- `note.test.ts` - Note commitment schemes
- `poseidon_*.test.ts` - Hash function compatibility

### Run Specific Test

```bash
pnpm test -- --grep "value_proof"
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
pnpm run compile:value-proof

# Step 2: Generate keys (requires compilation)
pnpm run setup:value-proof

# Step 3: Convert to compatible format (optional)
pnpm run convert:value-proof

# Or run all steps together
pnpm run full-build:value-proof
```

### Generate WASM for Rust (Witness Calculator)

**Why is this needed?**

The `primitives/encrypted-memo` primitive can use WASM to calculate the complete circuit witness (~740 wires) without reimplementing all Circom logic in Rust. This ensures:

- ✅ **Accuracy**: Executes the exact circuit logic
- ✅ **Maintainability**: Updates automatically when circuit is recompiled
- ✅ **Consistency**: Avoids bugs from code duplication
- ✅ **Completeness**: Generates all intermediate wires needed

**From circuits/circuits/ directory:**

```bash
# Compile value_proof.circom to WASM
circom value_proof.circom --wasm --output ../build/
```

**Generated file:**

- `build/value_proof_js/value_proof.wasm` (<1MB)

**Usage in Rust:**

```rust
// With feature flag: wasm-witness
let wasm_bytes = std::fs::read("circuits/build/value_proof_js/value_proof.wasm")?;;
let witness = calculate_witness_wasm(&wasm_bytes, &inputs, &signals)?;
```

**Note:** WASM is also generated automatically with `pnpm run build-all`.

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

**Purpose:** Withdraw a private note to a public account, with optional change note returned to the pool

**Statistics:**

- Constraints: 16,903
- Private inputs: 8 scalars + 20 Merkle path elements
- Public inputs: 7 (`merkle_root`, `nullifier`, `amount`, `recipient`, `asset_id`, `fee`, `change_commitment`)
- Tree depth: 20

**Features:**

- **Total unshield**: `note_value === amount + fee`, `change_commitment` must be `0`
- **Partial unshield**: `note_value === amount + fee + change_value`; `change_commitment` must equal `NoteCommitment(change_value, asset_id, change_owner_pubkey, change_blinding)`. The pallet inserts it into the Merkle tree.
- Merkle membership proof for the input note
- Nullifier derivation: `Poseidon(commitment, spending_key)`
- BabyPbk key derivation: `BabyPbk(spending_key)` derives `ownerPk (Ax)` inside the circuit (Constraint 0)
- u128 range checks on `note_value`, `fee`, and `change_value`
- Asset ID binding: `note_asset_id === asset_id`; change commitment pinned to same asset
- `recipient` is a public signal (validated non-zero in the pallet)

### Value Proof Circuit — `circuits/value_proof.circom`

**Purpose:** Proves a note commitment encodes exactly the declared relay fee amount before the runtime inserts it into the Merkle tree. Used by `pallet-shielded-pool::claim_shielded_fees`.

**Statistics:**

- Constraints: ~300
- Private inputs: 2 (`owner_pubkey`, `blinding`)
- Public inputs: 3 (`commitment`, `value`, `asset_id`)
- Public outputs: 1 (`owner_hash`)
- CircuitId: `6` (`CircuitId::VALUE_PROOF`)

**Features:**

- Commitment preimage proof: `commitment === Poseidon(value, asset_id, owner_pubkey, blinding)`
- Owner hash: `owner_hash = Poseidon(owner_pubkey)` — reveals owner identity hash for audit without exposing the raw key
- No Merkle proof, no spending key, no nullifier — proves note formation only
- Prevents inflation attacks: relayer cannot claim `value=10000` if commitment was built with `value=1000`
- Public signals layout (76 bytes): `commitment[0..32] | value[32..40] | asset_id[40..44] | owner_hash[44..76]`

## Security Properties

The following properties are enforced at the circuit level (R1CS constraints). They hold for any honest or adversarial prover — soundness is guaranteed by the Groth16 argument.

**Dummy input soundness**: `IsZero(input_values[i])` is deterministic in R1CS. A prover cannot set `is_dummy.out = 1` without `input_values[i]` being provably zero. Technique from Zcash Sapling.

**Dummy nullifier binding** (Constraint 9 in `transfer`): `nullifiers[i] * is_dummy[i].out === 0`. A prover cannot supply a real nullifier in a dummy slot while bypassing Merkle membership and ownership checks.

**Distinct nullifiers when both real** (Constraint 10 in `transfer`): `IsZero(nullifiers[0] - nullifiers[1]).out * both_real === 0`. Prevents spending the same note twice in one transaction. Conditioned on `both_real` so a 1-real + 1-dummy input is accepted without false rejection.

**Merkle path index binary** (in `merkle_tree.circom`): `path_index[i] * (path_index[i] - 1) === 0`. Prevents malformed Merkle proofs with non-binary path indices.

**Fee binding in `transfer` and `unshield`**: `fee` is a public input included in the conservation constraint. The pallet cannot alter the fee after the proof is generated — any change invalidates the proof.

**Change note integrity in `unshield`** (Constraint 8): when `change_value > 0`, the public `change_commitment` must equal `NoteCommitment(change_value, note_asset_id, change_owner_pubkey, change_blinding)`. When `change_value == 0`, `change_commitment` must be `0`. Any tampered commitment, wrong blinding, wrong owner, or wrong asset is rejected by the R1CS constraints.

**Anti-spam (pallet, two layers)**: `pallet-shielded-pool` rejects any `private_transfer` where all nullifiers are zero (both inputs dummy) — (1) in `validate_unsigned` (tx pool, `InvalidTransaction::Custom(2)`) and (2) in `execute` (`Error::InvalidAmount`). Prevents free Merkle tree inflation without a valid spend.

## Project Structure

```
circuits/
├── circuits/                  # Circom source files
│   ├── transfer.circom        # 2-in/2-out private transfer (33,687 constraints)
│   ├── unshield.circom        # Private → public withdrawal (16,903 constraints)
│   ├── value_proof.circom     # Relay fee value proof, no Merkle/nullifier (~300 constraints)
│   ├── note.circom            # NoteCommitment + Nullifier templates
│   ├── merkle_tree.circom     # MerkleTreeVerifier template
│   └── poseidon_wrapper.circom
├── build/                     # Compiled artifacts
│   ├── transfer_js/transfer.wasm
│   ├── value_proof_js/value_proof.wasm
│   └── verification_key_*.json
├── keys/                      # Cryptographic keys
│   ├── *_pk.zkey              # snarkjs proving keys
│   └── *_pk.ark               # arkworks proving keys (serialized)
├── test/                      # Test suites (135 tests)
├── scripts/                   # Build scripts
│   ├── build/                 # Compilation scripts
│   └── utils/                 # Manifest and lint utilities
└── package.json
```

## Requirements

- **Node.js** >= 18
- **npm** >= 9
- **circom** >= 2.2.0
- **snarkjs** >= 0.7.0

All requirements are checked automatically by build scripts.

## Troubleshooting

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
