# Private Transfer Circuit

**File**: [`circuits/transfer.circom`](../../circuits/transfer.circom)

## Purpose

The Transfer circuit enables private token transfers with zero-knowledge proofs. It proves that:

1. Each **real** input note exists in the Merkle tree (dummy inputs with `value = 0` are exempt)
2. The user owns each **real** input note (via `BabyPbk(spending_key)` key derivation; dummy inputs skip this check)
3. Output notes are computed correctly
4. Value is conserved (inputs sum equals outputs sum plus fee)
5. No value overflow occurs (u128 range)
6. All notes use the same asset ID
7. Both input nullifiers are distinct when both inputs are real (no self-double-spend)
8. Dummy input nullifiers are forced to zero (cannot carry a real nullifier while bypassing membership checks)

## Circuit Statement

> "I own one or two notes in the Merkle tree, and I'm spending them to create two new notes, while conserving the total value (minus an optional gasless fee paid to the block author) and maintaining asset consistency. If I only have one note, the second input slot is a dummy (value = 0) that bypasses membership and ownership checks."

## Security Properties

- **Double-Spend Prevention**: Nullifiers ensure each real note can only be spent once; dummy nullifiers are forced to zero and never inserted in the nullifier set
- **Distinct Nullifiers**: When both inputs are real, their nullifiers must differ — prevents spending the same note twice in one transaction
- **Dummy Input Soundness**: `IsZero(value)` is deterministic — a prover cannot claim `is_dummy = 1` for a note with `value > 0` (technique from Zcash Sapling)
- **Dummy Nullifier Binding**: Circuit enforces `nullifier[i] * is_dummy[i].out === 0`, so a dummy slot cannot carry a real nullifier while bypassing Merkle and ownership checks
- **Ownership Proof**: `BabyPbk(spending_key)` derives `ownerPk (Ax)` deterministically inside the circuit, proving the prover knows the discrete logarithm of the `ownerPk` embedded in the note commitment. Disabled for dummy slots.
- **Value Conservation**: Total input value equals total output value plus fee (dummy input contributes 0)
- **Merkle Membership**: Real input notes must exist in the commitment tree; dummy inputs are exempt
- **Range Safety**: All values and the fee are constrained to u128 range (no overflow; matches the runtime `Balance` type)
- **Asset Consistency**: All notes in a transaction must use the same asset
- **Public Asset Binding**: The public `asset_id` signal is constrained to equal the asset used in all notes
- **Anti-Spam (Pallet)**: The pallet rejects any transaction where all nullifiers are zero (both inputs dummy), preventing free Merkle tree inflation

## Public Inputs (Visible On-Chain)

| Input            | Type     | Description                                               |
| ---------------- | -------- | --------------------------------------------------------- |
| `merkle_root`    | Field    | Current Merkle tree root                                  |
| `nullifiers[2]`  | Field[2] | Nullifiers for the two input notes                        |
| `commitments[2]` | Field[2] | Commitments for the two output notes                      |
| `asset_id`       | Field    | Asset being transferred (must match all note asset IDs)   |
| `fee`            | Field    | Gasless fee deducted from input sum; paid to block author |

## Private Inputs (Known Only to Prover)

### Input Notes (Being Spent)

| Input                | Type     | Description                                                              |
| -------------------- | -------- | ------------------------------------------------------------------------ |
| `input_values[2]`    | u128[2]  | Values of input notes                                                    |
| `input_asset_ids[2]` | Field[2] | Asset IDs of input notes                                                 |
| `input_blindings[2]` | Field[2] | Blinding factors for input commitments                                   |
| `spending_keys[2]`   | Field[2] | Secret keys — both compute nullifiers and derive `ownerPk` via `BabyPbk` |

### Merkle Proofs

| Input                        | Type         | Description                       |
| ---------------------------- | ------------ | --------------------------------- |
| `input_path_elements[2][20]` | Field[2][20] | Sibling hashes for Merkle proofs  |
| `input_path_indices[2][20]`  | u8[2][20]    | Path directions (0=left, 1=right) |

### Output Notes (Being Created)

| Input                     | Type     | Description                             |
| ------------------------- | -------- | --------------------------------------- |
| `output_values[2]`        | u128[2]  | Values of output notes                  |
| `output_asset_ids[2]`     | Field[2] | Asset IDs of output notes               |
| `output_owner_pubkeys[2]` | Field[2] | Public keys of output note owners (Ax)  |
| `output_blindings[2]`     | Field[2] | Blinding factors for output commitments |

## Constraints

### 0. Dummy Input Detection

Before any check, the circuit determines which input slots are "dummy" (placeholder with `value = 0`). Dummy inputs bypass Merkle membership, nullifier derivation, and ownership checks.

```circom
component is_dummy[2];
for (var i = 0; i < 2; i++) {
    is_dummy[i] = IsZero();
    is_dummy[i].in <== input_values[i];
    // is_dummy[i].out == 1  iff  input_values[i] == 0
}
```

`IsZero` is deterministic in R1CS: a prover cannot set `out = 1` unless `in` is provably zero. This is the same technique used in Zcash Sapling.

### 1. Merkle Membership Verification

Proves each **real** input note exists in the commitment tree. Dummy inputs (value = 0) are exempt.

**For each input note i**:

```
input_commitment[i] = Poseidon(input_values[i], input_asset_ids[i], input_owner_Ax[i], input_blindings[i])
merkle_diff[i] = MerkleTreeVerifier(input_commitment[i], path).root - merkle_root
merkle_diff[i] * (1 - is_dummy[i].out) === 0
```

**Circuit Logic**:

```circom
for (var i = 0; i < 2; i++) {
    input_commitments[i] = NoteCommitment();
    // ... field assignments ...

    merkle_verifiers[i] = MerkleTreeVerifier(tree_depth);
    merkle_verifiers[i].leaf <== input_commitments[i].commitment;

    // Real inputs must be in the tree; dummy inputs (value == 0) are exempt
    merkle_diffs[i] <== merkle_verifiers[i].root - merkle_root;
    merkle_diffs[i] * (1 - is_dummy[i].out) === 0;
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

    // Only enforce for real (non-dummy) inputs
    nullifier_diffs[i] <== nullifier_computers[i].nullifier - nullifiers[i];
    nullifier_diffs[i] * (1 - is_dummy[i].out) === 0;
}
```

### 3. BabyPbk Key Derivation (Ownership Proof)

For each **real** input note, derives the owner public key from the spending key inside the circuit. The prover must know `spending_key` such that `BabyPbk(spending_key).Ax == ownerPk`. This is the discrete logarithm relation on BabyJubJub — it cannot be faked. Dummy inputs skip this check.

**For each input note i**:

```
ownerPk[i] = BabyPbk(spending_key[i]).Ax
commitment[i] = Poseidon(input_values[i], input_asset_ids[i], ownerPk[i], input_blindings[i])
```

**Circuit Logic**:

```circom
for (var i = 0; i < 2; i++) {
    key_derivation[i] = BabyPbk();
    key_derivation[i].in <== spending_keys[i];
    // key_derivation[i].Ax is the owner pubkey used in NoteCommitment
}
```

**Why BabyPbk instead of EdDSA?**

- BabyPbk proves the discrete log relation directly: prover knows `sk` such that `sk × Base8 = ownerPk`. EdDSA only proves knowledge of a signature (weaker interactive proof).
- Savings: ~6,000 fewer constraints per circuit (2× `EdDSAPoseidonVerifier` ≈ 6,000 constraints eliminated; 2× `BabyPbk` ≈ 5,000 constraints added).
- Simpler API: 10 fewer private input signals (no Ax/Ay/R8x/R8y/S per input).
- Matches Tornado Cash Nova's key derivation model.

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

Proves that total input value equals total output value plus the fee paid to the block author.

```
input_values[0] + input_values[1] == output_values[0] + output_values[1] + fee
```

**Circuit Logic**:

```circom
signal input_sum;
signal output_sum;

input_sum <== input_values[0] + input_values[1];
output_sum <== output_values[0] + output_values[1];

input_sum === output_sum + fee;
```

### 6. Range Checks

Ensures all note values are within u128 range (0 to 2^128-1), matching the runtime `Balance` type, to prevent overflow attacks.

**Circuit Logic**:

```circom
for (var i = 0; i < 2; i++) {
    input_range_checks[i] = Num2Bits(128);
    input_range_checks[i].in <== input_values[i];

    output_range_checks[i] = Num2Bits(128);
    output_range_checks[i].in <== output_values[i];
}
```

### 6b. Fee Range Check

Ensures the fee also fits within u128 range (defense-in-depth).

```circom
component fee_range_check = Num2Bits(128);
fee_range_check.in <== fee;
```

### 7. Asset Consistency

Ensures all notes in a transfer use the same asset ID (no mixing assets).

```circom
input_asset_ids[0] === input_asset_ids[1];
input_asset_ids[0] === output_asset_ids[0];
input_asset_ids[0] === output_asset_ids[1];
```

**Note**: The circuit accepts any asset ID. The runtime validates which assets are allowed.

### 8. Public Asset ID Binding

Ensures the public `asset_id` signal matches the asset used in all notes.

```circom
asset_id === input_asset_ids[0];
```

This constraint, combined with Constraint 7, guarantees that the on-chain public `asset_id` cannot differ from the notes' actual asset.

### 9. Dummy Nullifier Binding

Forces the nullifier of any dummy input to zero. Without this, a prover could supply a real nullifier in the dummy slot while bypassing Merkle and ownership checks, effectively spending a note without a membership proof.

```circom
// For each input i:
nullifiers[i] * is_dummy[i].out === 0;
```

If `is_dummy[i].out = 1` (value = 0), the constraint forces `nullifiers[i] = 0`. The pallet skips insertion of the zero nullifier into the nullifier set.

### 10. Distinct Nullifiers (real inputs only)

Prevents a prover from using the same input note twice in a single transaction. Without this, a prover could set both inputs to the same note — value conservation still holds but they extract double the value before the pallet inserts either nullifier.

The constraint is conditional: it only applies when both inputs are real.

```circom
signal both_real;
both_real <== (1 - is_dummy[0].out) * (1 - is_dummy[1].out);

component nullifiers_equal = IsZero();
nullifiers_equal.in <== nullifiers[0] - nullifiers[1];

signal must_be_distinct;
must_be_distinct <== nullifiers_equal.out * both_real;
must_be_distinct === 0;
```

| Scenario                           | `both_real` | `nullifiers_equal` | Passes?                  |
| ---------------------------------- | ----------- | ------------------ | ------------------------ |
| Both real, distinct nullifiers     | 1           | 0                  | ✅                       |
| Both real, same nullifier (attack) | 1           | 1                  | ❌                       |
| One dummy                          | 0           | any                | ✅                       |
| Both dummy                         | 0           | 1 (both 0)         | ✅ (pallet rejects this) |

## Circuit Parameters

- **Tree Depth**: 20 levels (supports up to 2^20 = 1,048,576 notes)
- **Constraints**: 33,687 (includes BabyPbk ×2 + dummy-input gates: 2×IsZero + conditional signals)
- **Public Inputs**: 7 (`merkle_root` + 2 `nullifiers` + 2 `commitments` + `asset_id` + `fee`)
- **Private Inputs**: 9 scalars + 40 Merkle path elements (2×20)
- **Proving Time**: ~2-3 seconds (local machine)
- **Verification Time**: ~15ms

## Usage Examples

### Standard Transfer (two real input notes)

Alice transfers 100 tokens to Bob using two of her notes:

```typescript
const input = {
    // Public
    merkle_root: currentRoot,
    nullifiers: [nullifier1, nullifier2], // both real, must be distinct
    commitments: [outputCommitment1, outputCommitment2],
    asset_id: 0n, // Native token
    fee: 1n, // 1 unit fee to block author

    // Private - Input Notes (Alice owns both)
    input_values: [60n, 41n], // Total: 101 = 100 (outputs) + 1 (fee)
    input_asset_ids: [0n, 0n],
    input_blindings: [blinding1, blinding2],
    spending_keys: [spendingKey1, spendingKey2], // ownerPk derived inside circuit via BabyPbk

    // Merkle proofs (both verified)
    input_path_elements: [path1, path2],
    input_path_indices: [indices1, indices2],

    // Private - Output Notes
    output_values: [100n, 0n], // 100 to Bob, 0 change (dummy output)
    output_asset_ids: [0n, 0n],
    output_owner_pubkeys: [bobPubkey, alicePubkey],
    output_blindings: [newBlinding1, newBlinding2],
};
```

### Single-Note Transfer (dummy second input)

Alice transfers 100 tokens to Bob using only one note (`value = 500`). The second input is a dummy — its Merkle proof and nullifier derivation are bypassed by the circuit.

```typescript
const ZERO_SIBLINGS = Array(20).fill("0");

const input = {
    // Public
    merkle_root: aliceNoteRoot,
    nullifiers: [nullifier1, "0"], // dummy nullifier MUST be '0' (Constraint 9)
    commitments: [outputCommitment1, outputCommitment2],
    asset_id: 0n,
    fee: 1n,

    // Private - Input Notes
    input_values: [101n, 0n], // dummy has value = 0 (triggers is_dummy[1] = 1)
    input_asset_ids: [0n, 0n],
    input_blindings: [blinding1, "0"],
    spending_keys: [spendingKey1, "1"], // dummy spending key — BabyPbk never checked for dummy

    // Dummy Merkle path — any values accepted (check disabled for dummy)
    input_path_elements: [path1, ZERO_SIBLINGS],
    input_path_indices: [indices1, Array(20).fill(0)],

    // Private - Output Notes
    output_values: [100n, 0n],
    output_asset_ids: [0n, 0n],
    output_owner_pubkeys: [bobPubkey, alicePubkey],
    output_blindings: [newBlinding1, newBlinding2],
};
```

The SDK helper `buildDummyTransferInput(assetId)` from `@orbinum/sdk` constructs the dummy slot automatically.

### Transfer with Change

Alice transfers 30 tokens to Bob, gets 70 as change:

```typescript
const input = {
    // Public
    merkle_root: currentRoot,
    nullifiers: [nullifier1, nullifier2],
    commitments: [outputCommitment1, outputCommitment2],
    asset_id: 0n,
    fee: 1n,

    // Private inputs
    input_values: [60n, 41n], // Total: 101 = 30 + 70 (outputs) + 1 (fee)
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
    asset_id: 0n,
    fee: 0n,

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

### Spending Key Management

- **Private Key Security**: Users must protect their spending keys
- **Key Derivation**: Derive spending keys from a master seed
- **Public Key**: `ownerPk = BabyPbk(spending_key).Ax` is computed inside the circuit — never passed as input

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

### Dummy Input Notes

When a user has only one note, the second input slot is filled with a dummy (value = 0). The circuit bypasses Merkle membership and nullifier derivation for dummy slots. The following rules apply:

| Field                    | Requirement                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| `input_values[i]`        | Must be `0`                                                          |
| `nullifiers[i]` (public) | Must be `0` (enforced by Constraint 9)                               |
| Merkle path              | Any value — check is disabled                                        |
| `spending_key`           | Any non-zero value (BabyPbk is computed but commitment uses value=0) |

**Security guarantee**: Because `IsZero` is deterministic in R1CS, a prover cannot claim `is_dummy = 1` for a note with positive value. A malicious prover who sets `value[i] > 0` but also sets `nullifiers[i] = 0` will fail Constraint 2 (nullifier derivation check is active for real notes).

**Pallet guarantee**: The pallet additionally rejects any transaction where **all** nullifiers are zero (both inputs dummy), preventing free Merkle tree inflation with zero-value commitments.

### Key Derivation

```typescript
import { buildBabyjub } from "circomlibjs";

const babyJub = await buildBabyjub();
const F = babyJub.F;

// Derive owner public key from spending key (mirrors BabyPbk in circuit)
const spendingKey = BigInt("0xdeadbeef...");
const [ownerAx, ownerAy] = babyJub.mulPointEscalar(babyJub.Base8, spendingKey);
const ownerPubkey = F.toObject(ownerAx); // Ax coordinate used in commitments
```

## Performance Optimization

### Constraint Count Analysis

| Section                     | Constraints |
| --------------------------- | ----------- |
| BabyPbk Key Derivation (×2) | ~5,000      |
| Merkle Verification (×2)    | ~8,000      |
| Nullifier Computation (×2)  | ~4,000      |
| Output Commitments (×2)     | ~4,000      |
| Balance Conservation        | ~100        |
| Range Checks (×4+fee)       | ~12,500     |
| Asset Consistency           | ~100        |
| **Total**                   | **33,687**  |

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
pnpm test -- test/transfer.test.ts
```

Run the transfer circuit tests:

```bash
pnpm test
```

End-to-end proof generation and verification lives downstream, in
[`groth16-proofs`](https://github.com/orbinum/groth16-proofs), which consumes
these artifacts.

## Build Artifacts

Generate transfer circuit artifacts:

```bash
pnpm run build:circuit transfer
```

This produces:

- `build/transfer.r1cs`
- `build/transfer_js/` (witness calculator)
- `keys/transfer_pk.zkey` (proving key)
- `build/verification_key_transfer.json`
- `build/transfer_pk.ark` (Rust proving key, if ark-circom installed)

## Common Issues

### Issue: Wrong Spending Key

**Cause**: `spending_key` doesn't correspond to the `ownerPk` encoded in the note commitment. `BabyPbk(spending_key).Ax` produces a different `ownerPk`, making the commitment mismatch the Merkle leaf.

**Solution**: Ensure the same spending key is used to create the note (shielding) and to spend it.

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

**Cause**: Input sum ≠ output sum + fee

**Solution**:

```typescript
const inputSum = input_values[0] + input_values[1];
const outputSum = output_values[0] + output_values[1];
assert(inputSum === outputSum + fee, "Balance not conserved: inputs must equal outputs + fee");
```

## Related Documentation

- [Note Circuit](note.md) - NoteCommitment and Nullifier components
- [Merkle Tree Circuit](merkle-tree.md) - MerkleTreeVerifier component
- [Unshield Circuit](unshield.md) - Related circuit for withdrawals
- [Architecture](../ARCHITECTURE.md) - System-level design
- [Quick Start Guide](../guides/quick-start.md)
