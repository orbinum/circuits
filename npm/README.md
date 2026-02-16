# @orbinum/circuits

Zero-Knowledge circuits for Orbinum privacy blockchain. This package contains compiled circuit artifacts for proof generation and verification.

[![npm version](https://img.shields.io/npm/v/@orbinum/circuits.svg)](https://www.npmjs.com/package/@orbinum/circuits)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](https://github.com/orbinum/circuits/blob/main/LICENSE)

## 🚀 Installation

```bash
npm install @orbinum/circuits
```

## 📦 Package Contents

This package includes **12 files** for 3 circuits (disclosure, transfer, unshield):

### For Each Circuit (disclosure, transfer, unshield):

1. **`{circuit}.wasm`** - Witness calculator (3 files)
2. **`{circuit}_pk.zkey`** - Proving key for snarkjs (3 files)
3. **`{circuit}_pk.ark`** - Proving key for arkworks/Rust (3 files)
4. **`verification_key_{circuit}.json`** - Verification key for on-chain verification (3 files)

## 🔧 Usage

### With snarkjs (JavaScript/TypeScript)

```typescript
import { join } from "path";
import { readFileSync } from "fs";

// Get circuit artifacts
const circuitsPath = require.resolve("@orbinum/circuits/package.json").replace("package.json", "");

// Load WASM witness calculator
const wasmPath = join(circuitsPath, "transfer.wasm");
const wasmBuffer = readFileSync(wasmPath);

// Load proving key (.zkey)
const zkeyPath = join(circuitsPath, "transfer_pk.zkey");
const zkeyBuffer = readFileSync(zkeyPath);

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

### 1. **Disclosure** (`disclosure_*`)

Selective disclosure circuit for privacy-preserving attribute revelation.

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
const result = await generateProof(CircuitType.Transfer, witnessInputs, numPublicSignals);

console.log("Proof:", result.proof);
console.log("Public signals:", result.publicSignals);
```

## 📄 File Sizes

- **WASM files**: ~1-2 MB each (witness calculators)
- **`.zkey` files**: ~7-9 MB each (snarkjs proving keys)
- **`.ark` files**: ~7-9 MB each (arkworks proving keys)
- **Verification keys**: ~3-4 KB each (JSON)

**Total package size**: ~50-60 MB

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
