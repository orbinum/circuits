# Private Transfer Circuit

**File**: [`circuits/transfer.circom`](../../circuits/transfer.circom)

## Purpose

The Transfer circuit enables private token transfers with zero-knowledge proofs. It proves that:

1. Input notes exist in the Merkle tree
2. The user owns the input notes (via EdDSA signature)
3. Output notes are computed correctly
4. Value is conserved (inputs sum equals outputs sum)
5. No value overflow occurs
6. All notes use the same asset ID

## Circuit Statement

> "I own two notes in the Merkle tree, and I'm spending them to create two new notes, while conserving the total value and maintaining asset consistency"

## Security Properties

- **Double-Spend Prevention**: Nullifiers ensure each note can only be spent once
- **Ownership Proof**: EdDSA signatures prove note ownership without revealing the spending key
- **Value Conservation**: Total input value equals total output value
- **Merkle Membership**: Input notes must exist in the commitment tree
- **Range Safety**: All values are constrained to u64 range (no overflow)
- **Asset Consistency**: All notes in a transaction must use the same asset

## Public Inputs (Visible On-Chain)

| Input            | Type     | Description                          |
| ---------------- | -------- | ------------------------------------ |
| `merkle_root`    | Field    | Current Merkle tree root             |
| `nullifiers[2]`  | Field[2] | Nullifiers for the two input notes   |
| `commitments[2]` | Field[2] | Commitments for the two output notes |

## Private Inputs (Known Only to Prover)

### Input Notes (Being Spent)

| Input                | Type     | Description                            |
| -------------------- | -------- | -------------------------------------- |
| `input_values[2]`    | u64[2]   | Values of input notes                  |
| `input_asset_ids[2]` | u32[2]   | Asset IDs of input notes               |
| `input_blindings[2]` | u256[2]  | Blinding factors for input commitments |
| `spending_keys[2]`   | Field[2] | Secret keys to compute nullifiers      |

### EdDSA Ownership Proof

| Input               | Type     | Description                                 |
| ------------------- | -------- | ------------------------------------------- |
| `input_owner_Ax[2]` | Field[2] | X-coordinates of EdDSA public keys (owners) |
| `input_owner_Ay[2]` | Field[2] | Y-coordinates of EdDSA public keys (owners) |
| `input_sig_R8x[2]`  | Field[2] | X-coordinates of signature R8 points        |
| `input_sig_R8y[2]`  | Field[2] | Y-coordinates of signature R8 points        |
| `input_sig_S[2]`    | Field[2] | Signature S scalars                         |

### Merkle Proofs

| Input                        | Type         | Description                       |
| ---------------------------- | ------------ | --------------------------------- |
| `input_path_elements[2][20]` | Field[2][20] | Sibling hashes for Merkle proofs  |
| `input_path_indices[2][20]`  | u8[2][20]    | Path directions (0=left, 1=right) |

### Output Notes (Being Created)

| Input                     | Type     | Description                             |
| ------------------------- | -------- | --------------------------------------- |
| `output_values[2]`        | u64[2]   | Values of output notes                  |
| `output_asset_ids[2]`     | u32[2]   | Asset IDs of output notes               |
| `output_owner_pubkeys[2]` | Field[2] | Public keys of output note owners       |
| `output_blindings[2]`     | u256[2]  | Blinding factors for output commitments |

## Constraints

### 1. Merkle Membership Verification

Proves each input note exists in the commitment tree.

**For each input note i**:

```
input_commitment[i] = Poseidon(input_values[i], input_asset_ids[i], input_owner_Ax[i], input_blindings[i])
merkle_root = MerkleTreeVerifier(input_commitment[i], path_elements[i], path_indices[i])
```

**Circuit Logic**:

```circom
for (var i = 0; i < 2; i++) {
    input_commitments[i] = NoteCommitment();
    input_commitments[i].value <== input_values[i];
    input_commitments[i].asset_id <== input_asset_ids[i];
    input_commitments[i].owner_pubkey <== input_owner_Ax[i];
    input_commitments[i].blinding <== input_blindings[i];

    merkle_verifiers[i] = MerkleTreeVerifier(tree_depth);
    merkle_verifiers[i].leaf <== input_commitments[i].commitment;
    merkle_verifiers[i].root === merkle_root;
}
```

### 2. Nullifier Correctness

Ensures nullifiers are computed correctly to prevent double-spending.

```
nullifier[i] = Poseidon(commitment[i], spending_key[i])
```

**Circuit Logic**:

```circom
for (var i = 0; i < 2; i++) {
    nullifier_computers[i] = Nullifier();
    nullifier_computers[i].commitment <== input_commitments[i].commitment;
    nullifier_computers[i].spending_key <== spending_keys[i];

    nullifier_computers[i].nullifier === nullifiers[i];
}
```

### 3. EdDSA Ownership Verification

Verifies EdDSA signature over the commitment to prove note ownership.

**For each input note i**:

```
EdDSA.Verify(
    public_key: (Ax[i], Ay[i]),
    signature: (R8x[i], R8y[i], S[i]),
    message: commitment[i]
) == true
```

**Circuit Logic**:

```circom
for (var i = 0; i < 2; i++) {
    eddsa_verifiers[i] = EdDSAPoseidonVerifier();
    eddsa_verifiers[i].enabled <== 1;

    eddsa_verifiers[i].Ax <== input_owner_Ax[i];
    eddsa_verifiers[i].Ay <== input_owner_Ay[i];

    eddsa_verifiers[i].R8x <== input_sig_R8x[i];
    eddsa_verifiers[i].R8y <== input_sig_R8y[i];
    eddsa_verifiers[i].S <== input_sig_S[i];

    eddsa_verifiers[i].M <== input_commitments[i].commitment;
}
```

**Why EdDSA?**

- Efficient in circuits (fewer constraints than ECDSA)
- Deterministic signatures (no nonce bias attacks)
- Designed for elliptic curves over prime fields (Baby Jubjub)

### 4. Output Commitment Computation

Ensures output commitments are computed correctly.

**For each output note i**:

```
commitments[i] = Poseidon(output_values[i], output_asset_ids[i], output_owner_pubkeys[i], output_blindings[i])
```

**Circuit Logic**:

```circom
for (var i = 0; i < 2; i++) {
    output_commitment_computers[i] = NoteCommitment();
    output_commitment_computers[i].value <== output_values[i];
    output_commitment_computers[i].asset_id <== output_asset_ids[i];
    output_commitment_computers[i].owner_pubkey <== output_owner_pubkeys[i];
    output_commitment_computers[i].blinding <== output_blindings[i];

    output_commitment_computers[i].commitment === commitments[i];
}
```

### 5. Balance Conservation

Proves that total input value equals total output value.

```
input_values[0] + input_values[1] == output_values[0] + output_values[1]
```

**Circuit Logic**:

```circom
signal input_sum;
signal output_sum;

input_sum <== input_values[0] + input_values[1];
output_sum <== output_values[0] + output_values[1];

input_sum === output_sum;
```

### 6. Range Checks

Ensures all values are within u64 range (0 to 2^64-1) to prevent overflow.

**Circuit Logic**:

```circom
for (var i = 0; i < 2; i++) {
    input_range_checks[i] = Num2Bits(64);
    input_range_checks[i].in <== input_values[i];

    output_range_checks[i] = Num2Bits(64);
    output_range_checks[i].in <== output_values[i];
}
```

### 7. Asset Consistency

Ensures all notes in a transfer use the same asset ID (no mixing assets).

```circom
input_asset_ids[0] === input_asset_ids[1];
input_asset_ids[0] === output_asset_ids[0];
input_asset_ids[0] === output_asset_ids[1];
```

**Note**: The circuit accepts any asset ID. The runtime validates which assets are allowed.

## Circuit Parameters

- **Tree Depth**: 20 levels (supports up to 2^20 = 1,048,576 notes)
- **Constraints**: ~32,000
- **Public Inputs**: 5 (1 merkle_root + 2 nullifiers + 2 commitments)
- **Private Inputs**: 28
- **Proving Time**: ~2-3 seconds (local machine)
- **Verification Time**: ~15ms

## Usage Examples

### Standard Transfer

Alice transfers 100 tokens to Bob:

```typescript
const input = {
    // Public
    merkle_root: currentRoot,
    nullifiers: [nullifier1, nullifier2],
    commitments: [outputCommitment1, outputCommitment2],

    // Private - Input Notes (Alice owns both)
    input_values: [60n, 40n], // Total: 100
    input_asset_ids: [0n, 0n], // Native token
    input_blindings: [blinding1, blinding2],
    spending_keys: [spendingKey1, spendingKey2],

    // EdDSA ownership proof
    input_owner_Ax: [alicePubkeyX, alicePubkeyX],
    input_owner_Ay: [alicePubkeyY, alicePubkeyY],
    input_sig_R8x: [sig1.R8[0], sig2.R8[0]],
    input_sig_R8y: [sig1.R8[1], sig2.R8[1]],
    input_sig_S: [sig1.S, sig2.S],

    // Merkle proofs
    input_path_elements: [path1, path2],
    input_path_indices: [indices1, indices2],

    // Private - Output Notes
    output_values: [100n, 0n], // Send 100 to Bob, 0 to dummy
    output_asset_ids: [0n, 0n],
    output_owner_pubkeys: [bobPubkey, alicePubkey],
    output_blindings: [newBlinding1, newBlinding2],
};
```

### Transfer with Change

Alice transfers 30 tokens to Bob, gets 70 as change:

```typescript
const input = {
    // Public
    merkle_root: currentRoot,
    nullifiers: [nullifier1, nullifier2],
    commitments: [outputCommitment1, outputCommitment2],

    // Private inputs
    input_values: [60n, 40n], // Total: 100
    output_values: [30n, 70n], // 30 to Bob, 70 change to Alice

    output_owner_pubkeys: [bobPubkey, alicePubkey],
    // ... rest of inputs
};
```

### Split Transaction

Alice splits one large note into two smaller notes (self-transfer):

```typescript
const input = {
    // Public
    merkle_root: currentRoot,
    nullifiers: [nullifier1, dummyNullifier],
    commitments: [outputCommitment1, outputCommitment2],

    // Private inputs
    input_values: [100n, 0n], // One note with 100, one dummy
    output_values: [60n, 40n], // Split into 60 and 40

    output_owner_pubkeys: [alicePubkey, alicePubkey],
    // ... rest of inputs
};
```

## Security Considerations

### Double-Spend Prevention

**Nullifier Uniqueness**: The runtime must maintain a nullifier set and reject any transaction with a previously used nullifier.

```rust
// Pseudo-code for runtime validation
if nullifier_set.contains(nullifier) {
    return Err("Double-spend detected");
}
nullifier_set.insert(nullifier);
```

### Merkle Root Validation

The runtime should validate the merkle_root against:

1. **Current root**: Most recent state
2. **Historic roots**: Recent past roots (prevents front-running)

```rust
if !is_valid_root(merkle_root) {
    return Err("Invalid merkle root");
}
```

### EdDSA Key Management

- **Private Key Security**: Users must protect their EdDSA private keys
- **Key Derivation**: Derive spending keys from a master seed
- **Signature Freshness**: Each signature should be over a unique commitment

### Asset Mixing Prevention

The circuit enforces asset consistency, but the runtime should additionally verify:

- Asset ID exists in the registry
- User has permission to transfer that asset (if applicable)

### Range Check Importance

Without range checks, malicious provers could:

- Create notes with negative values (underflow)
- Create notes with values > 2^64 (overflow)
- Exploit modular arithmetic to mint tokens

## Implementation Notes

### Tree Depth Selection

20-level tree supports:

- **Capacity**: 2^20 = 1,048,576 notes
- **Proof Size**: 20 × 32 bytes = 640 bytes per note
- **Trade-off**: Deeper trees → more capacity but larger proofs

### Dummy Notes

When spending only one note, use a dummy second note:

```typescript
{
  value: 0n,
  asset_id: 0n,
  owner_pubkey: anyPubkey,
  blinding: randomBlinding,
}
```

### EdDSA Signature Generation

```typescript
import { buildEddsa } from "circomlibjs";

const eddsa = await buildEddsa();
const privateKey = Buffer.from("...");
const message = commitment; // Sign the commitment

const signature = eddsa.signPoseidon(privateKey, message);
// signature contains: R8, S
```

## Performance Optimization

### Constraint Count Analysis

| Section                    | Constraints |
| -------------------------- | ----------- |
| Merkle Verification (×2)   | ~8,000      |
| Nullifier Computation (×2) | ~4,000      |
| EdDSA Verification (×2)    | ~12,000     |
| Output Commitments (×2)    | ~4,000      |
| Balance Conservation       | ~100        |
| Range Checks (×4)          | ~3,000      |
| Asset Consistency          | ~100        |
| **Total**                  | **~32,000** |

### Trusted Setup

- **Powers of Tau**: Requires at least 16 (2^16 = 65,536 constraints)
- **Phase 2**: Circuit-specific trusted setup
- **Recommended**: Use Powers of Tau 17 or higher for safety margin

### Proving Performance

| Hardware          | Proving Time | Memory Usage |
| ----------------- | ------------ | ------------ |
| MacBook Pro M1    | ~2.5s        | ~2GB         |
| AMD Ryzen 9 5950X | ~1.8s        | ~2GB         |
| AWS c5.2xlarge    | ~3.2s        | ~2GB         |

## Testing

Run transfer circuit tests:

```bash
npm test -- test/transfer.test.ts
```

Run end-to-end transfer test:

```bash
npm run test:e2e:transfer
```

## Build Artifacts

Generate transfer circuit artifacts:

```bash
npm run build:transfer
```

This produces:

- `build/transfer.r1cs`
- `build/transfer_js/` (witness calculator)
- `keys/transfer_pk.zkey` (proving key)
- `build/verification_key_transfer.json`
- `build/transfer_pk.ark` (Rust proving key, if ark-circom installed)

## Common Issues

### Issue: EdDSA Signature Verification Failed

**Cause**: Signature not generated correctly or over wrong message

**Solution**:

```typescript
// Ensure you sign the commitment, not the note fields
const commitment = poseidon([value, asset_id, owner_pubkey, blinding]);
const signature = eddsa.signPoseidon(privateKey, commitment);
```

### Issue: Merkle Verification Failed

**Cause**: Path elements or indices don't match the tree structure

**Solution**: Use the correct Merkle proof generation:

```typescript
const proof = merkleTree.getProof(leafIndex);
// proof.pathElements and proof.pathIndices must match circuit expectation
```

### Issue: Balance Not Conserved

**Cause**: Input sum ≠ output sum

**Solution**:

```typescript
const inputSum = input_values[0] + input_values[1];
const outputSum = output_values[0] + output_values[1];
assert(inputSum === outputSum, "Balance not conserved");
```

## Related Documentation

- [Note Circuit](note.md) - NoteCommitment and Nullifier components
- [Merkle Tree Circuit](merkle-tree.md) - MerkleTreeVerifier component
- [Unshield Circuit](unshield.md) - Related circuit for withdrawals
- [API: Generate Transfer Input](../api/generate-transfer-input.md)
- [API: Generate Transfer Proof](../api/generate-transfer-proof.md)
