# Note Primitives Circuit

**File**: [`circuits/note.circom`](../../circuits/note.circom)

## Purpose

The Note circuit provides fundamental cryptographic primitives for the Orbinum privacy protocol. It defines two core components used across all other circuits:

1. **NoteCommitment**: Creates hiding commitments to note data
2. **Nullifier**: Generates unique identifiers to prevent double-spending

These components are the building blocks for private transactions, enabling both privacy and security.

## Components

### NoteCommitment Template

Computes a cryptographic commitment to a note's data using Poseidon hash.

**Formula**:

```
commitment = Poseidon(value, asset_id, owner_pubkey, blinding)
```

**Circuit Definition**:

```circom
template NoteCommitment() {
    signal input value;
    signal input asset_id;
    signal input owner_pubkey;
    signal input blinding;
    signal output commitment;

    component hasher = Poseidon4();
    hasher.inputs[0] <== value;
    hasher.inputs[1] <== asset_id;
    hasher.inputs[2] <== owner_pubkey;
    hasher.inputs[3] <== blinding;

    commitment <== hasher.out;
}
```

#### Inputs

| Input          | Type  | Description                                |
| -------------- | ----- | ------------------------------------------ |
| `value`        | u64   | Amount of tokens in the note               |
| `asset_id`     | u32   | Asset identifier (0 = native, >0 = custom) |
| `owner_pubkey` | Field | Public key of the note owner               |
| `blinding`     | u256  | Random blinding factor for hiding          |

#### Output

| Output       | Type  | Description                          |
| ------------ | ----- | ------------------------------------ |
| `commitment` | Field | Cryptographic commitment to the note |

#### Properties

- **Hiding**: Without the blinding factor, the commitment reveals no information about value, asset_id, or owner
- **Binding**: Given a commitment, it's computationally infeasible to find different inputs that produce the same commitment
- **Deterministic**: Same inputs always produce the same commitment

#### Usage in Other Circuits

Used by:

- **Disclosure**: Verify commitment matches revealed fields
- **Transfer**: Compute input/output note commitments
- **Unshield**: Verify note commitment exists in tree

**Example**:

```typescript
import { poseidon } from "circomlibjs";

const note = {
    value: 100n,
    asset_id: 0n,
    owner_pubkey: 12345n,
    blinding: randomBigInt(256),
};

const commitment = poseidon([note.value, note.asset_id, note.owner_pubkey, note.blinding]);
```

---

### Nullifier Template

Computes a unique nullifier for a note to prevent double-spending.

**Formula**:

```
nullifier = Poseidon(commitment, spending_key)
```

**Circuit Definition**:

```circom
template Nullifier() {
    signal input commitment;
    signal input spending_key;
    signal output nullifier;

    component hasher = Poseidon2();
    hasher.inputs[0] <== commitment;
    hasher.inputs[1] <== spending_key;

    nullifier <== hasher.out;
}
```

#### Inputs

| Input          | Type  | Description                             |
| -------------- | ----- | --------------------------------------- |
| `commitment`   | Field | Note commitment to nullify              |
| `spending_key` | Field | Secret key known only to the note owner |

#### Output

| Output      | Type  | Description                   |
| ----------- | ----- | ----------------------------- |
| `nullifier` | Field | Unique nullifier for the note |

#### Properties

- **Uniqueness**: Each commitment + spending_key pair produces a unique nullifier
- **Unlinkability**: Without the spending_key, the nullifier cannot be linked to the commitment
- **Deterministic**: Same inputs always produce the same nullifier
- **One-Time Use**: Once a nullifier is published, the note cannot be spent again

#### Usage in Other Circuits

Used by:

- **Transfer**: Prove input notes are being spent
- **Unshield**: Prove note is being unshielded

**Example**:

```typescript
import { poseidon } from "circomlibjs";

const commitment = 123456789n;
const spendingKey = 987654321n;

const nullifier = poseidon([commitment, spendingKey]);
```

## Design Rationale

### Why Poseidon?

**Poseidon** is a ZK-friendly hash function optimized for circuits:

- **Efficient**: Fewer constraints than traditional hashes (SHA-256, Keccak)
- **Security**: Designed for prime field arithmetic
- **Constraint Count**:
    - Poseidon2 (2 inputs): ~150 constraints
    - Poseidon4 (4 inputs): ~200 constraints
    - Compare to SHA-256: ~25,000 constraints

### Commitment Scheme

The commitment scheme follows the **Pedersen commitment** pattern:

```
C = H(data || blinding)
```

**Benefits**:

- **Privacy**: Blinding hides the data
- **Integrity**: Cannot change data without changing commitment
- **Verifiability**: Can prove data matches commitment in ZK

### Nullifier Design

The nullifier design prevents **double-spending**:

1. **User spends note**: Publishes nullifier on-chain
2. **Runtime stores nullifier**: In a set/map
3. **Future spend attempt**: Rejected if nullifier already exists

**Why hash with spending_key?**

- Prevents adversaries from computing nullifiers without the key
- Only the owner can generate the correct nullifier
- Unlinkable: Observer cannot link nullifier to commitment

## Security Considerations

### Blinding Factor Randomness

**Critical**: The blinding factor must be cryptographically random:

```typescript
import { randomBytes } from "crypto";

// ✅ Good: Cryptographically secure random
const blinding = BigInt("0x" + randomBytes(32).toString("hex"));

// ❌ Bad: Predictable
const blinding = 123456n;
```

**Attack**: If blinding is predictable, an attacker can:

1. Guess the blinding factor
2. Recompute the commitment
3. Break privacy and identify notes

### Spending Key Protection

**Critical**: The spending key must be kept secret:

- **Storage**: Never store in plaintext
- **Derivation**: Derive from master seed
- **Transmission**: Never send over insecure channels

**Attack**: If spending key is leaked:

1. Attacker can compute nullifiers for all user's notes
2. Attacker can front-run user's transactions
3. User loses control over their notes

### Commitment Uniqueness

**Important**: Use fresh blinding for each note:

```typescript
// ✅ Good: Unique blinding per note
const note1 = { ..., blinding: randomBlinding() };
const note2 = { ..., blinding: randomBlinding() };

// ❌ Bad: Reusing blinding
const sharedBlinding = randomBlinding();
const note1 = { ..., blinding: sharedBlinding };
const note2 = { ..., blinding: sharedBlinding };
```

**Risk**: Reusing blinding can:

- Enable linking different notes
- Reduce anonymity set
- Leak information through statistical analysis

## Implementation Notes

### Key Management

**Best Practice**: Derive keys from a master seed using HKDF or similar:

```typescript
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";

function deriveSpendingKey(masterSeed: Uint8Array, noteIndex: number): bigint {
    const info = `orbinum-spending-key-${noteIndex}`;
    const derived = hkdf(sha256, masterSeed, undefined, info, 32);
    return BigInt("0x" + Buffer.from(derived).toString("hex"));
}
```

### Note Structure

**Recommended note structure**:

```typescript
interface Note {
    value: bigint; // u64
    asset_id: bigint; // u32
    owner_pubkey: bigint; // Field element
    blinding: bigint; // u256

    // Metadata (not in commitment)
    index?: number;
    merkle_path?: MerkleProof;
}
```

### Commitment Storage

**On-chain storage**:

```rust
// Substrate storage
StorageMap<_, Blake2_128Concat, FieldElement, (), ValueQuery>;

// Insert commitment
Commitments::insert(commitment, ());

// Check existence
let exists = Commitments::contains_key(commitment);
```

**Off-chain index**:

```typescript
// User's local database
interface CommitmentIndex {
    commitment: bigint;
    note: Note;
    spent: boolean;
    block_number: number;
}
```

### Nullifier Tracking

**Runtime storage**:

```rust
// Set of used nullifiers
StorageMap<_, Blake2_128Concat, FieldElement, (), ValueQuery>;

// Check nullifier
pub fn is_nullifier_used(nullifier: FieldElement) -> bool {
    Nullifiers::contains_key(nullifier)
}

// Mark nullifier as used
Nullifiers::insert(nullifier, ());
```

## Circuit Statistics

| Component      | Constraints | Poseidon Calls |
| -------------- | ----------- | -------------- |
| NoteCommitment | ~200        | 1 (Poseidon4)  |
| Nullifier      | ~150        | 1 (Poseidon2)  |

## Testing

Run note circuit tests:

```bash
npm test -- test/note.test.ts
```

Tests cover:

- Commitment computation correctness
- Nullifier computation correctness
- Consistency with circomlibjs implementation

## Usage Examples

### Creating a Note

```typescript
import { poseidon } from "circomlibjs";
import { randomBytes } from "crypto";

// Create note
const note = {
    value: 100n,
    asset_id: 0n,
    owner_pubkey: userPubkey,
    blinding: BigInt("0x" + randomBytes(32).toString("hex")),
};

// Compute commitment
const commitment = poseidon([note.value, note.asset_id, note.owner_pubkey, note.blinding]);

// Store in Merkle tree
await merkleTree.insert(commitment);
```

### Spending a Note

```typescript
import { poseidon } from "circomlibjs";

// Retrieve note from local database
const note = await db.getNoteByCommitment(commitment);

// Compute nullifier
const nullifier = poseidon([commitment, spendingKey]);

// Check not already spent
const isSpent = await checkNullifier(nullifier);
if (isSpent) {
    throw new Error("Note already spent");
}

// Use in transfer or unshield circuit
const circuitInput = {
    // ...
    commitment: commitment,
    nullifier: nullifier,
    spending_key: spendingKey,
    // ...
};
```

### Verifying a Commitment

```typescript
// Given public commitment and private note data
function verifyCommitment(commitment: bigint, note: Note): boolean {
    const computed = poseidon([note.value, note.asset_id, note.owner_pubkey, note.blinding]);

    return computed === commitment;
}
```

## Dependencies

- **Poseidon Hash**: From `circomlib`
    - `Poseidon2()`: 2-input hash (for nullifiers)
    - `Poseidon4()`: 4-input hash (for commitments)

## Performance Optimization

### Constraint Efficiency

The templates are already optimized:

- Use minimal Poseidon variants (2 or 4 inputs)
- No redundant constraints
- Directly pass signals (no intermediate computations)

### Batch Operations

When verifying multiple notes, batch Poseidon operations:

```typescript
// Batch commitment computation
const commitments = notes.map((note) =>
    poseidon([note.value, note.asset_id, note.owner_pubkey, note.blinding])
);
```

## Standards Compliance

These primitives follow common ZK privacy patterns:

- **Zcash-style commitments**: Similar to Sapling note commitments
- **Tornado Cash-style nullifiers**: Hash of commitment + secret
- **Industry standard**: Widely used in privacy protocols

## Future Enhancements

### Multi-Asset Optimization

For protocols with many assets, consider:

- Asset-specific commitment trees
- Separate nullifier sets per asset
- Reduces scanning overhead

### Quantum Resistance

For post-quantum security:

- Replace Poseidon with quantum-resistant hash
- Use lattice-based commitments
- Requires circuit redesign (higher constraints)

### Stateless Verification

Enable stateless nullifier verification:

- Merkle proof of non-inclusion
- Reduces on-chain storage
- Increases circuit complexity

## Related Documentation

- [Poseidon Wrapper](poseidon-wrapper.md) - Poseidon hash implementations
- [Disclosure Circuit](disclosure.md) - Uses NoteCommitment
- [Transfer Circuit](transfer.md) - Uses both NoteCommitment and Nullifier
- [Unshield Circuit](unshield.md) - Uses both NoteCommitment and Nullifier
