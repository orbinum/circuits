# Circuit Documentation

This directory contains detailed technical documentation for each zero-knowledge circuit in the Orbinum protocol.

## Available Circuits

### Core Privacy Circuits

- **[Transfer](transfer.md)** - Private token transfers with BabyPbk ownership verification (discrete log proof)
- **[Unshield](unshield.md)** - Convert private notes to public tokens (withdrawal)
- **[Shield](shield.md)** - Bind a deposit's commitment to the deposited value and asset

### Supporting Components

- **[Note](note.md)** - Note commitment and nullifier primitives
- **[Merkle Tree](merkle-tree.md)** - Merkle tree membership verification
- **[Poseidon Wrapper](poseidon-wrapper.md)** - Poseidon hash function wrappers

## Circuit Overview

All circuits use the **Groth16** proving system and are compiled with **Circom 2.0.0+**. They implement the cryptographic primitives necessary for the Orbinum privacy protocol on Substrate.

### Common Design Patterns

1. **Public vs Private Inputs**: Each circuit clearly separates public inputs (visible on-chain) from private inputs (known only to the prover)

2. **Commitment Scheme**: All circuits use Poseidon hash for commitments:

    ```
    commitment = Poseidon(value, asset_id, owner_pubkey, blinding)
    ```

3. **Nullifier System**: Prevents double-spending:

    ```
    nullifier = Poseidon(commitment, spending_key)
    ```

4. **Range Checks**: Every value a prover chooses is constrained to 128-bit unsigned integers (u128, matching the runtime `Balance` type). Shield's `value` is set by the pallet from a `u128`, so it needs none

5. **Merkle Tree**: 20-level binary Merkle tree for commitment storage

### Security Properties

- **Soundness**: Cannot forge proofs without knowing private inputs
- **Zero-Knowledge**: Private inputs remain cryptographically hidden
- **Completeness**: Valid proofs always verify successfully
- **Binding**: Proofs are bound to specific public inputs

## Reading the Documentation

Each circuit document includes:

- **Purpose**: What the circuit proves
- **Security Properties**: Guarantees provided by the circuit
- **Public Inputs**: Values visible on-chain
- **Private Inputs**: Values known only to the prover
- **Constraints**: Detailed explanation of each cryptographic constraint
- **Circuit Parameters**: Configurable values (tree depth, etc.)
- **Usage Examples**: How to generate inputs and proofs
- **Performance Metrics**: Constraint count and proving time

## Circuit Statistics

| Circuit  | Constraints | Public Inputs | Private Inputs      | Tree Depth |
| -------- | ----------- | ------------- | ------------------- | ---------- |
| Transfer | 33,688      | 8             | 9 (+40 Merkle path) | 20         |
| Unshield | 16,904      | 8             | 7 (+40 Merkle path) | 20         |
| Shield   | 736         | 3             | 2                   | —          |

## Build Artifacts

Each circuit produces the following artifacts:

- `.r1cs` - Rank-1 Constraint System representation
- `_js/` - JavaScript witness calculator (WASM)
- `.zkey` - Groth16 proving key (for JavaScript/TypeScript)
- `.ark` - Arkworks proving key (for Rust/Substrate)
- `verification_key.json` - Groth16 verification key

## Additional Resources

- [Architecture Documentation](../ARCHITECTURE.md)
- [Arkworks Integration Guide](../guides/arkworks-integration.md)
- [Build Scripts](../../scripts/build/)
