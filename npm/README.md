# @orbinum/circuits

Zero-Knowledge circuits for Orbinum privacy blockchain. This package contains compiled circuit artifacts for proof generation and verification.

[![npm version](https://img.shields.io/npm/v/@orbinum/circuits.svg)](https://www.npmjs.com/package/@orbinum/circuits)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](https://github.com/orbinum/circuits/blob/main/LICENSE)

## 🚀 Installation

```bash
npm install @orbinum/circuits
```

## 📦 Package Contents

This package includes the artifacts for 3 circuits (value_proof, transfer, unshield):

### For Each Circuit (value_proof, transfer, unshield):

1. **`{circuit}.wasm`** - Witness calculator
2. **`{circuit}.r1cs`** - R1CS constraint system — for custom provers / verification
3. **`{circuit}_pk.zkey`** - Proving key for snarkjs
4. **`verification_key_{circuit}.json`** - Verification key for on-chain verification

## 🔧 Usage

### With snarkjs (JavaScript/TypeScript)

```typescript
import { join } from "path";
import { readFileSync } from "fs";
import { getCircuitPaths } from "@orbinum/circuits";

// Get all paths for a circuit
const paths = getCircuitPaths("transfer"); // 'value_proof' | 'transfer' | 'unshield'

// Load WASM witness calculator
const wasmBuffer = readFileSync(paths.wasm);

// Load proving key (.zkey)
const zkeyBuffer = readFileSync(paths.zkey);

// Load R1CS (e.g. for custom prover or constraint inspection)
const r1csBuffer = readFileSync(paths.r1cs);

// Use with snarkjs for proof generation
// ... snarkjs proof generation code ...
```

### With arkworks (Rust)

```rust
use std::fs::File;
use ark_circom::read_zkey;

// Load proving key (.ark format)
let mut ark_file = File::open("transfer_pk.ark")?;
let proving_key = read_proving_key(&mut ark_file)?;

// Use for proof generation
// ... arkworks proof generation code ...
```

### Verification Keys (On-chain)

```typescript
import verificationKey from "@orbinum/circuits/verification_key_transfer.json";

// Use for on-chain verification in Substrate runtime
// The JSON contains the verification key in a format ready for the runtime
```

## 📋 Available Circuits

### 1. **Value Proof** (`value_proof_*`)

Proves that a note commitment encodes exactly the declared relay fee amount. Used by `pallet-shielded-pool::claim_shielded_fees` to prevent inflation attacks. `CircuitId = 6`.

### 2. **Transfer** (`transfer_*`)

Private token transfer circuit with 2 inputs and 2 outputs.

### 3. **Unshield** (`unshield_*`)

Withdrawal circuit from private pool to public account.

## 🔗 Related Packages

- [@orbinum/proof-generator](https://www.npmjs.com/package/@orbinum/proof-generator) - High-level proof orchestrator
- [@orbinum/groth16-proofs](https://www.npmjs.com/package/@orbinum/groth16-proofs) - Arkworks WASM proof generator

## 💡 Usage Example with @orbinum/proof-generator

```typescript
import { generateProof, CircuitType } from "@orbinum/proof-generator";

// Proof generator automatically loads circuits from @orbinum/circuits
const result = await generateProof(CircuitType.ValueProof, witnessInputs, numPublicSignals);

console.log("Proof:", result.proof);
console.log("Public signals:", result.publicSignals);
```

## 📄 File Sizes

- **WASM files**: ~1-3 MB each (witness calculators)
- **R1CS files**: ~1-5 MB each (constraint systems)
- **`.zkey` files**: ~0.5-20 MB each (snarkjs proving keys)
- **`.ark` files**: ~0.2-9 MB each (arkworks proving keys)
- **Verification keys**: ~3-4 KB each (JSON)

**Total package size**: ~80-90 MB

## 🔒 Security Notice

⚠️ **Important**: These circuit artifacts are for **testing and development only**.

For production deployment, a **multi-party trusted setup ceremony** is required to generate secure proving/verification keys.

## 📖 Circuit Specifications

For detailed circuit specifications, constraints, and integration guides:

- [Circuit Documentation](https://github.com/orbinum/circuits/tree/main/docs)
- [Integration Guide](https://github.com/orbinum/circuits/blob/main/docs/INTEGRATION.md)

## 🐛 Issues

Report issues at: https://github.com/orbinum/circuits/issues

## 📄 License

GPL-3.0 - See [LICENSE](https://github.com/orbinum/circuits/blob/main/LICENSE)
