# Poseidon Hash Wrappers

**File**: [`circuits/poseidon_wrapper.circom`](../../circuits/poseidon_wrapper.circom)

## Purpose

The Poseidon Wrapper circuit provides convenient wrappers around the Poseidon hash function from circomlib. These wrappers standardize the interface for different input sizes used throughout the Orbinum protocol.

## Why Poseidon?

**Poseidon** is a cryptographic hash function specifically designed for zero-knowledge proof systems:

### Advantages

- **ZK-Friendly**: Optimized for arithmetic circuits over prime fields
- **Efficient**: Significantly fewer constraints than traditional hashes
- **Secure**: Designed with rigorous cryptographic analysis
- **Flexible**: Supports variable input sizes

### Constraint Comparison

| Hash Function | Constraints (2 inputs) | Constraints (4 inputs) |
| ------------- | ---------------------- | ---------------------- |
| Poseidon      | ~150                   | ~200                   |
| MiMC          | ~600                   | ~1,200                 |
| SHA-256       | ~25,000                | ~25,000                |
| Keccak-256    | ~45,000                | ~45,000                |

**Result**: Poseidon is **100-300x more efficient** than traditional hashes in circuits.

## Components

### Poseidon2 Template

Wrapper for Poseidon hash with 2 inputs.

**Circuit Definition**:

```circom
template Poseidon2() {
    signal input inputs[2];
    signal output out;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== inputs[0];
    hasher.inputs[1] <== inputs[1];

    out <== hasher.out;
}
```

#### Inputs

| Input       | Type     | Description                |
| ----------- | -------- | -------------------------- |
| `inputs[2]` | Field[2] | Two field elements to hash |

#### Output

| Output | Type  | Description                        |
| ------ | ----- | ---------------------------------- |
| `out`  | Field | Hash digest (single field element) |

#### Usage

Used for:

- **Nullifier computation**: `Poseidon(commitment, spending_key)`
- **Merkle tree nodes**: `Poseidon(left_child, right_child)`
- **Key derivation**: `Poseidon(master_key, index)`

#### Example

```typescript
import { poseidon } from "circomlibjs";

const input1 = 123n;
const input2 = 456n;

const hash = poseidon([input1, input2]);
// hash is a single field element
```

#### Constraint Count

- **~150 constraints** for 2 inputs
- Actual count depends on Poseidon configuration and field size

---

### Poseidon4 Template

Wrapper for Poseidon hash with 4 inputs.

**Circuit Definition**:

```circom
template Poseidon4() {
    signal input inputs[4];
    signal output out;

    component hasher = Poseidon(4);
    hasher.inputs[0] <== inputs[0];
    hasher.inputs[1] <== inputs[1];
    hasher.inputs[2] <== inputs[2];
    hasher.inputs[3] <== inputs[3];

    out <== hasher.out;
}
```

#### Inputs

| Input       | Type     | Description                 |
| ----------- | -------- | --------------------------- |
| `inputs[4]` | Field[4] | Four field elements to hash |

#### Output

| Output | Type  | Description                        |
| ------ | ----- | ---------------------------------- |
| `out`  | Field | Hash digest (single field element) |

#### Usage

Used for:

- **Note commitments**: `Poseidon(value, asset_id, owner_pubkey, blinding)`
- **Multi-field hashing**: Any 4-field data structure

#### Example

```typescript
import { poseidon } from "circomlibjs";

const value = 100n;
const assetId = 0n;
const ownerPubkey = 12345n;
const blinding = 67890n;

const commitment = poseidon([value, assetId, ownerPubkey, blinding]);
```

#### Constraint Count

- **~200 constraints** for 4 inputs
- More efficient than hashing pairs: `Poseidon2(Poseidon2(a, b), Poseidon2(c, d))` ≈ 450 constraints

## Design Rationale

### Why Wrappers?

The wrappers provide:

1. **Standardized Interface**: Consistent API across the codebase
2. **Clarity**: Explicit input count in template name
3. **Flexibility**: Easy to add more variants (Poseidon3, Poseidon5, etc.)
4. **Documentation**: Clear usage patterns

### Input Size Selection

- **Poseidon2**: Binary operations (Merkle trees, nullifiers)
- **Poseidon4**: Note commitments (4 fields: value, asset, owner, blinding)

**Why not Poseidon1?**

- Poseidon(1) is essentially a permutation, not a traditional hash
- For single inputs, use Poseidon2 with a constant second input

**Why not PoseidonN for larger N?**

- Our protocol doesn't require hashing more than 4 fields at once
- Can always nest hashes: `Poseidon2(hash1, hash2)`

## Security Properties

### Collision Resistance

**Definition**: Finding two inputs that produce the same output is computationally infeasible.

```
Find x ≠ y such that Poseidon(x) = Poseidon(y)
```

**Security Level**: 128-bit security (for BN254 field)

### Preimage Resistance

**Definition**: Given a hash output, finding any input that produces it is computationally infeasible.

```
Given h, find x such that Poseidon(x) = h
```

**Security Level**: ~254-bit security

### Second Preimage Resistance

**Definition**: Given input x, finding different input y that produces same hash is infeasible.

```
Given x, find y ≠ x such that Poseidon(x) = Poseidon(y)
```

**Security Level**: ~254-bit security

## Implementation Notes

### Field Element Size

Poseidon operates over prime fields. For BN254 curve (used in Groth16):

- **Field prime**: `p = 21888242871839275222246405745257275088548364400416034343698204186575808495617`
- **Bit size**: ~254 bits
- **Element range**: `[0, p-1]`

**Important**: Inputs must be within the field. Values larger than `p` are reduced modulo `p`.

### Hash Output Domain

Poseidon output is a single field element:

- **Output size**: ~254 bits
- **Output range**: `[0, p-1]`
- **Representation**: BigInt in JavaScript/TypeScript

### Deterministic Behavior

Poseidon is deterministic:

```typescript
// Same inputs always produce same output
poseidon([1n, 2n]) === poseidon([1n, 2n]); // true
```

**Implication**: For randomness, inputs must include a random value (e.g., blinding factor).

## Usage Patterns

### Pattern 1: Commitment with Hiding

```circom
// Commitment: hash(data, random_blinding)
component commitment = Poseidon2();
commitment.inputs[0] <== data;
commitment.inputs[1] <== blinding;

signal output <== commitment.out;
```

**Properties**:

- Hiding: Blinding prevents guessing data
- Binding: Cannot change data without changing commitment

### Pattern 2: Nullifier Generation

```circom
// Nullifier: hash(commitment, secret_key)
component nullifier = Poseidon2();
nullifier.inputs[0] <== commitment;
nullifier.inputs[1] <== secret_key;

signal output <== nullifier.out;
```

**Properties**:

- Unique per commitment
- Unlinkable without secret key

### Pattern 3: Merkle Tree Nodes

```circom
// Parent: hash(left_child, right_child)
component parent = Poseidon2();
parent.inputs[0] <== left;
parent.inputs[1] <== right;

signal output <== parent.out;
```

**Properties**:

- Efficiently verifiable
- Compact tree structure

### Pattern 4: Multi-Field Commitment

```circom
// Note: hash(value, asset, owner, blinding)
component note = Poseidon4();
note.inputs[0] <== value;
note.inputs[1] <== asset_id;
note.inputs[2] <== owner_pubkey;
note.inputs[3] <== blinding;

signal output <== note.out;
```

**Properties**:

- Single hash for 4 fields
- More efficient than nested hashes

## Performance Optimization

### Constraint Count

| Template  | Inputs | Constraints | Use Case                 |
| --------- | ------ | ----------- | ------------------------ |
| Poseidon2 | 2      | ~150        | Nullifiers, Merkle nodes |
| Poseidon4 | 4      | ~200        | Note commitments         |

### Proving Time

| Operation                | Time (M1 Mac) |
| ------------------------ | ------------- |
| Single Poseidon2         | ~0.5ms        |
| Single Poseidon4         | ~0.7ms        |
| 10x Poseidon2 in circuit | ~5ms          |
| 10x Poseidon4 in circuit | ~7ms          |

**Note**: Times are approximate and depend on overall circuit complexity.

### Memory Usage

- **Witness Generation**: Minimal (<1MB per hash)
- **Proving**: Scales with total circuit constraints
- **Verification**: Constant (independent of hash count)

## Testing

Run Poseidon wrapper tests:

```bash
npm test -- test/poseidon_wrapper.test.ts
```

Run Poseidon compatibility tests (with circomlibjs):

```bash
npm test -- test/poseidon_compat.test.ts
```

Tests verify:

- Output matches circomlibjs implementation
- Consistency across different input values
- Edge cases (zero inputs, max field values)

## Comparison with Other Hashes

### vs MiMC

| Aspect          | Poseidon        | MiMC            |
| --------------- | --------------- | --------------- |
| Constraints     | ~150 (2 inputs) | ~600 (2 inputs) |
| Security        | 128-bit         | 128-bit         |
| Speed (native)  | Slower          | Faster          |
| Speed (circuit) | **Faster**      | Slower          |

**Verdict**: Poseidon is superior for circuits.

### vs SHA-256

| Aspect          | Poseidon        | SHA-256           |
| --------------- | --------------- | ----------------- |
| Constraints     | ~150 (2 inputs) | ~25,000           |
| Security        | 128-bit         | 256-bit           |
| Speed (native)  | Much slower     | **Much faster**   |
| Speed (circuit) | **Much faster** | Much slower       |
| Standards       | Newer           | Industry standard |

**Verdict**: Poseidon is vastly better for circuits; SHA-256 is standard for non-ZK contexts.

### vs Keccak-256

| Aspect          | Poseidon        | Keccak-256  |
| --------------- | --------------- | ----------- |
| Constraints     | ~150 (2 inputs) | ~45,000     |
| Security        | 128-bit         | 256-bit     |
| Speed (native)  | Slower          | **Faster**  |
| Speed (circuit) | **Much faster** | Much slower |
| Ethereum        | No              | **Native**  |

**Verdict**: Poseidon for ZK circuits; Keccak for Ethereum compatibility.

## Security Considerations

### Trusted Parameters

Poseidon uses:

- **Round constants**: Derived using secure methods
- **MDS matrix**: Maximum Distance Separable for diffusion
- **Number of rounds**: Sufficient for security target

**Circomlib's Poseidon**: Uses widely-audited parameters.

### Domain Separation

For different use cases, consider domain separation:

```typescript
// Add domain tag as first input
const DOMAIN_NULLIFIER = 0n;
const DOMAIN_COMMITMENT = 1n;

const nullifier = poseidon([DOMAIN_NULLIFIER, commitment, key]);
const commitment = poseidon([DOMAIN_COMMITMENT, value, blinding]);
```

**Benefit**: Prevents cross-protocol attacks.

### Input Validation

**Always validate inputs are in field**:

```typescript
const FIELD_MODULUS = BigInt("21888...617"); // BN254 prime

function validateFieldElement(x: bigint): void {
    if (x < 0n || x >= FIELD_MODULUS) {
        throw new Error(`Invalid field element: ${x}`);
    }
}
```

### Birthday Attacks

With 254-bit output:

- **Collision resistance**: ~2^127 operations (infeasible)
- **Birthday bound**: √(2^254) = 2^127

**Conclusion**: Secure against collision attacks.

## Common Issues

### Issue: Inconsistent Hashes Between Circuit and JS

**Cause**: Different Poseidon implementations or incorrect input ordering

**Solution**: Always use the same library (circomlibjs) and verify:

```typescript
import { buildPoseidon } from "circomlibjs";

const poseidon = await buildPoseidon();

// Correct usage
const hash = poseidon([input1, input2]);

// Verify matches circuit output
assert(hash === circuitOutput.out);
```

### Issue: Field Overflow

**Cause**: Input value exceeds field modulus

**Solution**: Reduce modulo field prime

```typescript
const FIELD_MODULUS = BigInt("21888...617");

function toField(x: bigint): bigint {
    return x % FIELD_MODULUS;
}

const hash = poseidon([toField(largeValue), input2]);
```

### Issue: Wrong Input Count

**Cause**: Using Poseidon2 with 4 inputs or vice versa

**Solution**: Use correct template

```typescript
// ❌ Wrong
const hash = poseidon([a, b, c, d]); // 4 inputs
// But circuit uses Poseidon2() expecting 2

// ✅ Correct
const hash = poseidon([a, b]); // 2 inputs for Poseidon2
const hash4 = poseidon([a, b, c, d]); // 4 inputs for Poseidon4
```

## Integration with circomlibjs

### Installation

```bash
npm install circomlibjs
```

### Basic Usage

```typescript
import { buildPoseidon } from "circomlibjs";

// Build Poseidon instance (async)
const poseidon = await buildPoseidon();

// Hash 2 inputs
const hash2 = poseidon([123n, 456n]);

// Hash 4 inputs
const hash4 = poseidon([1n, 2n, 3n, 4n]);

// Hash arbitrary number of inputs
const hashN = poseidon([1n, 2n, 3n, 4n, 5n, 6n]);
```

### TypeScript Types

```typescript
type FieldElement = bigint;

interface PoseidonHash {
    (inputs: FieldElement[]): FieldElement;
    F: any; // Field object
}
```

## Related Documentation

- [Note Circuit](note.md) - Uses Poseidon2 and Poseidon4
- [Merkle Tree](merkle-tree.md) - Uses Poseidon2
- [Disclosure Circuit](disclosure.md) - Uses Poseidon variants
- [Transfer Circuit](transfer.md) - Uses Poseidon variants
- [Unshield Circuit](unshield.md) - Uses Poseidon variants

## External Resources

- [Poseidon Paper](https://eprint.iacr.org/2019/458.pdf) - Original research
- [circomlib Documentation](https://github.com/iden3/circomlib) - Implementation details
- [Poseidon Hash Comparison](https://www.poseidon-hash.info/) - Benchmarks and analysis
- [ZK-Friendly Hash Functions](https://github.com/ingonyama-zk/papers/blob/main/zk_friendly_hash_functions.pdf) - Overview of alternatives
