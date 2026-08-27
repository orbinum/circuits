# Unshield Circuit

**File**: [`circuits/unshield.circom`](../../circuits/unshield.circom)

## Purpose

The Unshield circuit converts a private note to public tokens. It supports two modes:

- **Total unshield**: withdraw the full note value (`change_value = 0`).
- **Partial unshield**: withdraw part of the note value and return the remainder as a new private change note (`change_value > 0`).

In both cases the prover proves ownership of a note in the Merkle tree without revealing any private field beyond what is made public.

## Circuit Statement

> "I own a note in the Merkle tree. I am withdrawing `amount` to a public address, paying `fee` to the relayer, and (optionally) returning `change_value` to the pool as a new commitment. The sum of all three equals my note value."

## Security Properties

- **Ownership Proof**: `BabyPbk(spending_key)` derives `ownerPk (Ax)` inside the circuit, proving knowledge of the discrete logarithm of the `ownerPk` embedded in the note commitment.
- **Double-Spend Prevention**: Nullifier ensures the note can only be unshielded once.
- **Merkle Membership**: Note must exist in the commitment tree.
- **Conservation of Value**: `note_value === amount + fee + change_value`. Neither inflation nor loss of funds is possible.
- **Change Note Integrity**: When `change_value > 0`, the public `change_commitment` must equal `NoteCommitment(change_value, asset_id, change_owner_pubkey, change_blinding)`. When `change_value == 0`, `change_commitment` must be `0`.
- **Asset Consistency**: Revealed `asset_id` must match note's internal `note_asset_id`; the change note is bound to the same asset.
- **Range Safety**: `note_value`, `fee`, and `change_value` are all constrained to u128 (matches runtime `Balance`).

## Public Inputs (Visible On-Chain)

| Input               | Type  | Description                                                                      |
| ------------------- | ----- | -------------------------------------------------------------------------------- |
| `merkle_root`       | Field | Current Merkle tree root                                                         |
| `nullifier`         | Field | Nullifier to prevent double-spend                                                |
| `amount`            | Field | Net withdrawal amount (recipient receives this)                                  |
| `recipient`         | Field | Recipient address (validated non-zero in runtime)                                |
| `asset_id`          | Field | Asset ID being unshielded (publicly revealed)                                    |
| `fee`               | Field | Gasless fee deducted from note value; paid to block author                       |
| `change_commitment` | Field | `0` for total unshield; `NoteCommitment(change_value, ...)` for partial unshield |

## Private Inputs (Known Only to Prover)

| Input                 | Type      | Description                                                                |
| --------------------- | --------- | -------------------------------------------------------------------------- |
| `note_value`          | Field     | Value in the note (`amount + fee + change_value`)                          |
| `note_asset_id`       | Field     | Asset ID in note (must match public `asset_id`)                            |
| `note_blinding`       | Field     | Random blinding factor                                                     |
| `spending_key`        | Field     | Secret key — derives `ownerPk` via `BabyPbk` and computes nullifier        |
| `change_value`        | Field     | Amount returned to the pool; `0` for total unshield                        |
| `change_blinding`     | Field     | Blinding factor for the change note (unused when `change_value == 0`)      |
| `change_owner_pubkey` | Field     | BabyJubJub `Ax` of the change note owner (unused when `change_value == 0`) |
| `path_elements[20]`   | Field[20] | Sibling hashes for Merkle proof                                            |
| `path_indices[20]`    | u8[20]    | Path directions (`0`=left, `1`=right)                                      |

## Constraints

### 0. BabyPbk Key Derivation (Ownership Proof)

Derives the owner public key from the spending key inside the circuit. The prover must know `spending_key` such that `BabyPbk(spending_key).Ax == ownerPk`. This is the discrete log relation on BabyJubJub.

```circom
component key_derivation = BabyPbk();
key_derivation.in <== spending_key;
// key_derivation.Ax is the owner pubkey used in NoteCommitment (Constraint 3)
```

### 1. Amount + Fee Matches Note Value

The note value must cover both the net withdrawal amount and the fee.

```circom
note_value === amount + fee;
```

**Purpose**: Prevents withdrawing more (or less) than the note covers after fee deduction.

### 2. Range Checks

Ensure `note_value` and `fee` are within u128 range (matches runtime `Balance` type).

```circom
component value_range_check = Num2Bits(128);
value_range_check.in <== note_value;

component fee_range_check = Num2Bits(128);
fee_range_check.in <== fee;
```

**Purpose**: Prevents overflow attacks and ensures values match the runtime `Balance` type.

### 3. Note Commitment Computation

Compute the commitment that should be in the Merkle tree. The owner pubkey is derived from `spending_key` via BabyPbk (Constraint 0) — it is no longer an explicit private input.

```
commitment = Poseidon(note_value, note_asset_id, BabyPbk(spending_key).Ax, note_blinding)
```

**Circuit Logic**:

```circom
component commitment_computer = NoteCommitment();
commitment_computer.value <== note_value;
commitment_computer.asset_id <== note_asset_id;
commitment_computer.owner_pubkey <== key_derivation.Ax;  // derived, not a private input
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
- **Constraints**: 16,903
- **Public Inputs**: 7 (`merkle_root`, `nullifier`, `amount`, `recipient`, `asset_id`, `fee`, `change_commitment`)
- **Private Inputs**: 9 signals (+ 40 for Merkle proof path)
- **Proving Time**: ~750ms (local machine)
- **Verification Time**: ~15ms

## Usage Examples

### Total Unshield (Full Withdrawal)

Alice withdraws the full value of a 100-token note to her public address:

```typescript
const input = {
    // Public — visible on-chain
    merkle_root: currentRoot,
    nullifier: computedNullifier,
    amount: 99n, // net withdrawal (note_value - fee)
    recipient: alicePublicAddress,
    asset_id: 0n, // native token
    fee: 1n,
    change_commitment: 0n, // total unshield — no change note

    // Private — only Alice knows
    note_value: 100n, // amount + fee + change_value = 99 + 1 + 0
    note_asset_id: 0n,
    note_blinding: randomBlinding,
    spending_key: aliceSpendingKey,
    change_value: 0n,
    change_blinding: 0n, // unused when change_value == 0
    change_owner_pubkey: 0n, // unused when change_value == 0

    // Merkle proof
    path_elements: merkleProof.pathElements,
    path_indices: merkleProof.pathIndices,
};
```

### Partial Unshield (With Change Note)

Alice withdraws 60 tokens from a 100-token note and sends the remaining 39 (after 1 fee) back into the pool as a new private note:

```typescript
const changeValue = 39n;
const changeOwner = aliceOwnerAx; // self-change; can be any BabyJubJub Ax
const changeBlinding = randomBlinding2;
const changeCommitment = poseidon([changeValue, assetId, changeOwner, changeBlinding]);

const input = {
    // Public — visible on-chain
    merkle_root: currentRoot,
    nullifier: computedNullifier,
    amount: 60n,
    recipient: alicePublicAddress,
    asset_id: 0n,
    fee: 1n,
    change_commitment: changeCommitment, // non-zero: pallet inserts this leaf

    // Private
    note_value: 100n, // 60 + 1 + 39 = 100
    note_asset_id: 0n,
    note_blinding: randomBlinding,
    spending_key: aliceSpendingKey,
    change_value: 39n,
    change_blinding: changeBlinding,
    change_owner_pubkey: changeOwner,

    path_elements: merkleProof.pathElements,
    path_indices: merkleProof.pathIndices,
};
```

The pallet sees `change_commitment != 0` and inserts it into the Merkle tree. Alice can later spend this note with the standard `unshield` or `private_transfer` circuit.

### Multi-Asset Unshield

Alice withdraws 500 of asset #42:

```typescript
const input = {
    // Public
    merkle_root: currentRoot,
    nullifier: computedNullifier,
    amount: 498n,
    recipient: alicePublicAddress,
    asset_id: 42n, // Custom asset
    fee: 2n,

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

While the circuit ensures `note_value` is u128, the runtime should additionally check:

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
    note_blinding: note.blinding,
    spending_key: spendingKey, // ownerPk computed as BabyPbk(spending_key).Ax inside circuit

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

Signal counts per component, from `build/unshield.sym`. These are signals
rather than constraints — the two are close but not equal — and they are given
this way because they can be re-derived from the compiled circuit rather than
maintained by hand:

```sh
cut -d, -f4 build/unshield.sym | grep -oE 'main\.[a-z_]+' | sort | uniq -c | sort -rn
```

| Component                     | Signals |
| ----------------------------- | ------- |
| `merkle_verifier` (20 levels) | 15,543  |
| `key_derivation` (BabyPbk)    | 10,114  |
| `commitment_computer`         | 1,177   |
| `change_commitment_computer`  | 1,177   |
| `nullifier_computer`          | 773     |
| range checks (3 × Num2Bits)   | 387     |

Total constraints: **16,903** (`snarkjs r1cs info build/unshield.r1cs`).

The Merkle verification dominates: twenty levels of Poseidon2 is most of the
circuit, and it is where a depth change is felt. The range checks are the
cheapest part, not the most expensive — an earlier version of this table had
those two figures the other way round.

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
pnpm test -- test/unshield.test.ts
```

## Build Artifacts

Generate unshield circuit artifacts:

```bash
pnpm run build:circuit unshield
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
| **Constraints**     | 16,903           | 33,687             |
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
- [Arkworks integration](../guides/arkworks-integration.md) - consuming the `.ark` artifacts
