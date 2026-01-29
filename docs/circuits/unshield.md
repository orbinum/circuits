# Unshield Circuit

**File**: [`circuits/unshield.circom`](../../circuits/unshield.circom)

## Purpose

The Unshield circuit converts a private note to public tokens. It proves that a user owns a note in the Merkle tree and can withdraw its value to a public address. This is the exit mechanism from the privacy pool, making funds publicly visible again.

## Circuit Statement

> "I own a note in the Merkle tree, and I'm revealing its amount to withdraw to a public address"

## Security Properties

- **Ownership Proof**: Must prove knowledge of the note's spending key
- **Double-Spend Prevention**: Nullifier ensures the note can only be unshielded once
- **Merkle Membership**: Note must exist in the commitment tree
- **Amount Integrity**: Revealed amount must match note's value
- **Asset Consistency**: Revealed asset ID must match note's asset
- **Range Safety**: Value is constrained to u64 range

## Public Inputs (Visible On-Chain)

| Input         | Type  | Description                                   |
| ------------- | ----- | --------------------------------------------- |
| `merkle_root` | Field | Current Merkle tree root                      |
| `nullifier`   | Field | Nullifier to prevent double-spend             |
| `amount`      | u64   | Amount being withdrawn (publicly revealed)    |
| `recipient`   | Field | Recipient address (publicly revealed)         |
| `asset_id`    | u32   | Asset ID being unshielded (publicly revealed) |

## Private Inputs (Known Only to Prover)

| Input               | Type      | Description                                   |
| ------------------- | --------- | --------------------------------------------- |
| `note_value`        | u64       | Value in the note (must equal amount)         |
| `note_asset_id`     | u32       | Asset ID in note (must match public asset_id) |
| `note_owner`        | Field     | Owner public key                              |
| `note_blinding`     | u256      | Random blinding factor                        |
| `spending_key`      | Field     | Secret key to compute nullifier               |
| `path_elements[20]` | Field[20] | Sibling hashes for Merkle proof               |
| `path_indices[20]`  | u8[20]    | Path directions (0=left, 1=right)             |

## Constraints

### 1. Amount Matches Note Value

The publicly revealed amount must equal the note's value.

```circom
amount === note_value;
```

**Purpose**: Prevents withdrawing more (or less) than deposited.

### 2. Range Check

Ensure note_value is within u64 range (0 to 2^64-1).

```circom
component value_range_check = Num2Bits(64);
value_range_check.in <== note_value;
```

**Purpose**: Prevents overflow attacks and ensures value is valid u64.

### 3. Note Commitment Computation

Compute the commitment that should be in the Merkle tree.

```
commitment = Poseidon(note_value, note_asset_id, note_owner, note_blinding)
```

**Circuit Logic**:

```circom
component commitment_computer = NoteCommitment();
commitment_computer.value <== note_value;
commitment_computer.asset_id <== note_asset_id;
commitment_computer.owner_pubkey <== note_owner;
commitment_computer.blinding <== note_blinding;

signal computed_commitment;
computed_commitment <== commitment_computer.commitment;
```

### 4. Merkle Membership Verification

Prove the commitment exists in the Merkle tree.

```circom
component merkle_verifier = MerkleTreeVerifier(tree_depth);
merkle_verifier.leaf <== computed_commitment;

for (var i = 0; i < tree_depth; i++) {
    merkle_verifier.path_elements[i] <== path_elements[i];
    merkle_verifier.path_index[i] <== path_indices[i];
}

merkle_verifier.root === merkle_root;
```

**Purpose**: Proves the note exists and hasn't been tampered with.

### 5. Nullifier Verification

Compute nullifier and verify it matches the public input.

```
nullifier = Poseidon(commitment, spending_key)
```

**Circuit Logic**:

```circom
component nullifier_computer = Nullifier();
nullifier_computer.commitment <== computed_commitment;
nullifier_computer.spending_key <== spending_key;

nullifier_computer.nullifier === nullifier;
```

**Purpose**: Links the spending to this specific note and prevents double-spend.

### 6. Asset ID Consistency

Ensure the note's asset_id matches the public asset_id.

```circom
note_asset_id === asset_id;
```

**Purpose**: Prevents unshielding a note with a different asset than declared.

## Circuit Parameters

- **Tree Depth**: 20 levels (supports up to 2^20 = 1,048,576 notes)
- **Constraints**: ~12,000
- **Public Inputs**: 5
- **Private Inputs**: 8 (+ 40 for Merkle proof)
- **Proving Time**: ~800ms (local machine)
- **Verification Time**: ~10ms

## Usage Examples

### Basic Unshield (Withdrawal)

Alice withdraws 100 tokens from her private note to her public address:

```typescript
const input = {
    // Public - Visible on-chain
    merkle_root: currentRoot,
    nullifier: computedNullifier,
    amount: 100n,
    recipient: alicePublicAddress,
    asset_id: 0n, // Native token

    // Private - Only Alice knows
    note_value: 100n,
    note_asset_id: 0n,
    note_owner: alicePubkey,
    note_blinding: randomBlinding,
    spending_key: aliceSpendingKey,

    // Merkle proof
    path_elements: merkleProof.pathElements,
    path_indices: merkleProof.pathIndices,
};
```

### Partial Unshield

Alice has a 100 token note but only wants to withdraw 60 (not supported directly):

**Note**: This circuit unshields the entire note. For partial withdrawal, use the Transfer circuit to split the note first:

```typescript
// Step 1: Transfer to split note
Transfer: 100 → [60 (new note), 40 (change)]

// Step 2: Unshield the 60 note
Unshield: 60 → public address
```

### Multi-Asset Unshield

Alice withdraws 500 of asset #42:

```typescript
const input = {
    // Public
    merkle_root: currentRoot,
    nullifier: computedNullifier,
    amount: 500n,
    recipient: alicePublicAddress,
    asset_id: 42n, // Custom asset

    // Private
    note_value: 500n,
    note_asset_id: 42n,
    // ... rest of inputs
};
```

## Security Considerations

### Double-Spend Prevention

**Critical**: The runtime must maintain a nullifier set to prevent double-spending:

```rust
// Pseudo-code for runtime validation
if nullifier_set.contains(nullifier) {
    return Err("Note already unshielded");
}
nullifier_set.insert(nullifier);
```

### Recipient Validation

The circuit does NOT validate that `recipient != 0`. This check must be performed in the runtime:

```rust
if recipient == 0 {
    return Err("Cannot unshield to zero address");
}
```

**Rationale**: Checking in the runtime is more efficient than adding constraints to the circuit.

### Merkle Root Validation

The runtime should validate the merkle_root against:

1. **Current root**: Most recent state
2. **Historic roots**: Recent past roots (within N blocks)

```rust
if !is_recent_root(merkle_root, MAX_HISTORY) {
    return Err("Merkle root too old or invalid");
}
```

### Amount Range

While the circuit ensures `note_value` is u64, the runtime should additionally check:

- Minimum unshield amount (to prevent dust attacks)
- Maximum unshield amount (if needed for security)

```rust
if amount < MIN_UNSHIELD_AMOUNT {
    return Err("Amount below minimum");
}
```

### Asset Registry Validation

The runtime must verify:

- Asset ID exists in the registry
- Asset is not paused or restricted
- User has permission to unshield (if needed)

```rust
let asset = asset_registry.get(asset_id)
    .ok_or("Asset not found")?;

if asset.is_paused {
    return Err("Asset transfers paused");
}
```

## Implementation Notes

### Input Preparation

Generate the required inputs:

```typescript
import { poseidon } from "circomlibjs";

// 1. Compute commitment
const commitment = poseidon([note.value, note.asset_id, note.owner_pubkey, note.blinding]);

// 2. Compute nullifier
const nullifier = poseidon([commitment, spendingKey]);

// 3. Get Merkle proof
const merkleProof = merkleTree.getProof(leafIndex);

// 4. Prepare input
const circuitInput = {
    merkle_root: merkleTree.root,
    nullifier: nullifier,
    amount: note.value,
    recipient: recipientAddress,
    asset_id: note.asset_id,

    note_value: note.value,
    note_asset_id: note.asset_id,
    note_owner: note.owner_pubkey,
    note_blinding: note.blinding,
    spending_key: spendingKey,

    path_elements: merkleProof.pathElements,
    path_indices: merkleProof.pathIndices,
};
```

### Tree Depth Considerations

- **20 levels**: 1,048,576 notes capacity
- **Proof size**: 20 × 32 bytes = 640 bytes
- **Verification cost**: O(tree_depth) in runtime

### Spending Key Management

The spending key should be:

- Derived from a master seed
- Unique per note or user
- Kept secret (only owner knows it)

```typescript
// Example key derivation
import { deriveKey } from "./crypto";

const masterSeed = "..."; // User's master secret
const spendingKey = deriveKey(masterSeed, "spending", noteIndex);
```

## Performance Optimization

### Constraint Count Analysis

| Section                | Constraints |
| ---------------------- | ----------- |
| Amount Check           | 1           |
| Range Check (Num2Bits) | ~3,000      |
| Commitment Computation | ~2,000      |
| Merkle Verification    | ~4,000      |
| Nullifier Computation  | ~2,000      |
| Asset ID Check         | 1           |
| **Total**              | **~12,000** |

### Trusted Setup

- **Powers of Tau**: Requires at least 15 (2^15 = 32,768 constraints)
- **Recommended**: Use Powers of Tau 16 or higher
- **Phase 2**: Circuit-specific setup

### Proving Performance

| Hardware          | Proving Time | Memory Usage |
| ----------------- | ------------ | ------------ |
| MacBook Pro M1    | ~750ms       | ~1GB         |
| AMD Ryzen 9 5950X | ~600ms       | ~1GB         |
| AWS c5.2xlarge    | ~900ms       | ~1GB         |

## Testing

Run unshield circuit tests:

```bash
npm test -- test/unshield.test.ts
```

## Build Artifacts

Generate unshield circuit artifacts:

```bash
npm run build:unshield
```

This produces:

- `build/unshield.r1cs`
- `build/unshield_js/` (witness calculator)
- `keys/unshield_pk.zkey` (proving key)
- `build/verification_key_unshield.json`
- `build/unshield_pk.ark` (Rust proving key, if ark-circom installed)

## Integration with Runtime

### Extrinsic Flow

1. **User**: Generate proof with `unshield` circuit
2. **User**: Submit `unshield` extrinsic with:
    - Proof bytes
    - Public inputs (merkle_root, nullifier, amount, recipient, asset_id)
3. **Runtime**: Verify proof
4. **Runtime**: Check nullifier not used
5. **Runtime**: Validate recipient != 0
6. **Runtime**: Validate merkle_root is recent
7. **Runtime**: Transfer public tokens to recipient
8. **Runtime**: Insert nullifier into spent set

### Storage Updates

```rust
// After successful unshield
NullifierSet::insert(nullifier);
PublicBalances::mutate(recipient, asset_id, |balance| {
    *balance = balance.saturating_add(amount);
});

// Emit event
Events::deposit_event(Event::Unshielded {
    nullifier,
    amount,
    recipient,
    asset_id,
});
```

## Use Cases

1. **Withdrawal**: Exit privacy pool to use tokens publicly
2. **Payment**: Pay a public merchant from private balance
3. **Exchange Deposit**: Move funds from privacy pool to exchange
4. **Compliance**: Reveal funds for auditing or legal requirements
5. **Liquidation**: Close position and return to public balance

## Common Issues

### Issue: Nullifier Already Used

**Cause**: Attempting to unshield a note twice

**Solution**: Check nullifier is not in the spent set before submitting

```typescript
const isSpent = await checkNullifier(nullifier);
if (isSpent) {
    throw new Error("Note already spent");
}
```

### Issue: Merkle Root Invalid

**Cause**: Using outdated Merkle root

**Solution**: Fetch recent root before generating proof

```typescript
const currentRoot = await fetchCurrentMerkleRoot();
// Use currentRoot in circuit input
```

### Issue: Amount Mismatch

**Cause**: Public amount doesn't match note value

**Solution**: Ensure consistency

```typescript
assert(circuitInput.amount === circuitInput.note_value, "Amount must match note value");
```

### Issue: Asset ID Mismatch

**Cause**: Public asset_id doesn't match note's asset_id

**Solution**: Ensure consistency

```typescript
assert(circuitInput.asset_id === circuitInput.note_asset_id, "Asset IDs must match");
```

## Comparison with Transfer

| Feature             | Unshield         | Transfer           |
| ------------------- | ---------------- | ------------------ |
| **Purpose**         | Private → Public | Private → Private  |
| **Inputs**          | 1 note           | 2 notes            |
| **Outputs**         | Public balance   | 2 notes            |
| **Amount Revealed** | Yes (public)     | No (hidden)        |
| **Recipient Type**  | Public address   | Private note owner |
| **Constraints**     | ~12,000          | ~32,000            |
| **Proving Time**    | ~800ms           | ~2.5s              |

## Future Improvements

### Batch Unshielding

Allow unshielding multiple notes in one proof:

- Reduces transaction costs
- More efficient for large withdrawals
- Requires circuit redesign

### Minimal Reveal

Add option to prove minimum balance without revealing exact amount:

- "I have at least X tokens"
- Useful for eligibility proofs
- Requires range proof integration

### Time Locks

Add time-lock constraints:

- "This note can only be unshielded after timestamp T"
- Useful for vesting schedules
- Requires timestamp verification in circuit

## Related Documentation

- [Note Circuit](note.md) - NoteCommitment and Nullifier components
- [Merkle Tree Circuit](merkle-tree.md) - MerkleTreeVerifier component
- [Transfer Circuit](transfer.md) - For splitting notes before unshielding
- [API: Generate Unshield Input](../api/generate-unshield-input.md)
- [API: Generate Unshield Proof](../api/generate-unshield-proof.md)
