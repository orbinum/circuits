# Merkle Tree Verifier Circuit

**File**: [`circuits/merkle_tree.circom`](../../circuits/merkle_tree.circom)

## Purpose

The Merkle Tree Verifier circuit proves that a leaf exists in a Merkle tree with a given root. This is fundamental for privacy protocols, enabling users to prove note membership without revealing which specific note they're referencing.

## Circuit Statement

> "I know a leaf that is part of a Merkle tree with this root, and here's the proof path"

## Components

### Selector Template

Helper component for conditional selection in Merkle path computation.

**Circuit Definition**:

```circom
template Selector() {
    signal input in[2];
    signal input s;  // 0 or 1
    signal output out;

    out <== (in[1] - in[0]) * s + in[0];
}
```

**Behavior**:

- If `s = 0`: `out = in[0]`
- If `s = 1`: `out = in[1]`

**Usage**: Selects which sibling hash to place left/right during Merkle path computation.

---

### MerkleTreeVerifier Template

Main component that verifies Merkle membership proofs.

**Circuit Definition**:

```circom
template MerkleTreeVerifier(levels) {
    signal input leaf;
    signal input path_elements[levels];
    signal input path_index[levels];  // 0 = left, 1 = right
    signal output root;

    component hashers[levels];
    component selectors[levels];
    signal current_hash[levels + 1];

    current_hash[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // Boolean constraint on path_index
        path_index[i] * (path_index[i] - 1) === 0;

        selectors[i] = Selector();
        selectors[i].in[0] <== current_hash[i];
        selectors[i].in[1] <== path_elements[i];
        selectors[i].s <== path_index[i];

        hashers[i] = Poseidon2();
        hashers[i].inputs[0] <== selectors[i].out;
        hashers[i].inputs[1] <== current_hash[i] + path_elements[i] - selectors[i].out;

        current_hash[i + 1] <== hashers[i].out;
    }

    root <== current_hash[levels];
}
```

#### Inputs

| Input                   | Type    | Description                           |
| ----------------------- | ------- | ------------------------------------- |
| `leaf`                  | Field   | Leaf value (e.g., note commitment)    |
| `path_elements[levels]` | Field[] | Sibling hashes along the path to root |
| `path_index[levels]`    | u8[]    | Path directions (0 = left, 1 = right) |

#### Output

| Output | Type  | Description          |
| ------ | ----- | -------------------- |
| `root` | Field | Computed Merkle root |

#### Parameters

| Parameter | Type | Description                           |
| --------- | ---- | ------------------------------------- |
| `levels`  | u8   | Tree depth (e.g., 20 for 2^20 leaves) |

## How It Works

### Merkle Tree Structure

A binary Merkle tree stores commitments as leaves and computes a root hash:

```
         root
        /    \
      h1      h2
     / \     /  \
   h3  h4  h5  h6
   /\  /\  /\  /\
  c0 c1...    c7
```

- **Leaves**: Note commitments (c0, c1, ...)
- **Internal nodes**: Hashes of child pairs
- **Root**: Single hash representing entire tree

### Verification Algorithm

To verify leaf `L` is in the tree:

1. **Start with leaf**: `current = L`
2. **For each level** (bottom to top):
    - Get sibling hash `S` from `path_elements`
    - If `path_index = 0`: `current` is left child → `hash(current, S)`
    - If `path_index = 1`: `current` is right child → `hash(S, current)`
    - Update `current` to the computed hash
3. **Compare**: Final `current` must equal `root`

### Path Index Interpretation

| path_index | Meaning          | Hash Order             |
| ---------- | ---------------- | ---------------------- |
| 0          | Current is LEFT  | hash(current, sibling) |
| 1          | Current is RIGHT | hash(sibling, current) |

### Example

Tree with depth 3:

```
         root
        /    \
      h1      h2
     / \     /  \
   h3  h4  h5  h6
   /\  /\  /\  /\
  c0 c1 c2 c3 c4 c5 c6 c7
```

Prove `c2` is in tree:

- **Leaf**: c2
- **Path elements**: [c3, h4, h2]
- **Path indices**: [0, 1, 0]

**Verification steps**:

1. Level 0: `c2` is left of `c3` → `h5 = hash(c2, c3)` ✓
2. Level 1: `h5` is right of `h4` → `h1 = hash(h4, h5)` ✓
3. Level 2: `h1` is left of `h2` → `root = hash(h1, h2)` ✓

## Constraints

### 1. Boolean Constraint on Path Indices

Each `path_index` must be 0 or 1:

```circom
path_index[i] * (path_index[i] - 1) === 0;
```

**Purpose**: Prevents malicious proofs with invalid path directions.

### 2. Hash Computation

At each level, compute parent hash:

```circom
hashers[i].inputs[0] <== selectors[i].out;  // Left child
hashers[i].inputs[1] <== current + sibling - selectors[i].out;  // Right child
```

**Selector logic**:

- `path_index = 0`: `selector.out = current` (left child)
- `path_index = 1`: `selector.out = sibling` (right child is current)

**Hash inputs**:

- `inputs[0]` = left child
- `inputs[1]` = right child

### 3. Root Equality

The final computed hash must match the public root:

```circom
root <== current_hash[levels];
```

## Circuit Parameters

### Default Configuration (Transfer & Unshield)

- **Levels**: 20
- **Capacity**: 2^20 = 1,048,576 leaves
- **Proof Size**: 20 × 32 bytes = 640 bytes
- **Constraints per verification**: ~4,000

### Constraint Count

| Component                | Constraints   |
| ------------------------ | ------------- |
| Boolean checks (×levels) | levels        |
| Selectors (×levels)      | ~3 × levels   |
| Poseidon2 (×levels)      | ~150 × levels |
| **Total (levels=20)**    | **~3,100**    |

## Usage Examples

### Basic Verification

```typescript
import { poseidon } from "circomlibjs";

// Build tree
const tree = new MerkleTree(20);
tree.insert(commitment1);
tree.insert(commitment2);
tree.insert(commitment3);

// Get proof for commitment2
const proof = tree.getProof(1); // Index 1

// Circuit input
const input = {
    leaf: commitment2,
    path_elements: proof.pathElements,
    path_index: proof.pathIndices,
};

// Expected output
// root === tree.root
```

### Manual Proof Computation

```typescript
// Verify proof manually (off-circuit)
function verifyMerkleProof(
    leaf: bigint,
    pathElements: bigint[],
    pathIndices: number[],
    expectedRoot: bigint
): boolean {
    let current = leaf;

    for (let i = 0; i < pathElements.length; i++) {
        const sibling = pathElements[i];

        if (pathIndices[i] === 0) {
            // Current is left child
            current = poseidon([current, sibling]);
        } else {
            // Current is right child
            current = poseidon([sibling, current]);
        }
    }

    return current === expectedRoot;
}
```

### Tree Construction

```typescript
class MerkleTree {
    private levels: number;
    private nodes: Map<string, bigint>;
    private leaves: bigint[];

    constructor(levels: number) {
        this.levels = levels;
        this.nodes = new Map();
        this.leaves = [];
    }

    insert(leaf: bigint): void {
        this.leaves.push(leaf);
        this.rebuild();
    }

    private rebuild(): void {
        const capacity = 2 ** this.levels;

        // Pad with zeros
        const paddedLeaves = [...this.leaves];
        while (paddedLeaves.length < capacity) {
            paddedLeaves.push(0n);
        }

        // Build tree bottom-up
        let currentLevel = paddedLeaves;

        for (let level = 0; level < this.levels; level++) {
            const nextLevel: bigint[] = [];

            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = currentLevel[i + 1];
                const parent = poseidon([left, right]);

                nextLevel.push(parent);
                this.nodes.set(`${level}-${i / 2}`, parent);
            }

            currentLevel = nextLevel;
        }
    }

    getRoot(): bigint {
        return this.nodes.get(`${this.levels - 1}-0`) || 0n;
    }

    getProof(leafIndex: number): MerkleProof {
        const pathElements: bigint[] = [];
        const pathIndices: number[] = [];

        let index = leafIndex;

        for (let level = 0; level < this.levels; level++) {
            const isLeft = index % 2 === 0;
            const siblingIndex = isLeft ? index + 1 : index - 1;

            // Get sibling
            const sibling = this.leaves[siblingIndex] || 0n;
            pathElements.push(sibling);
            pathIndices.push(isLeft ? 0 : 1);

            index = Math.floor(index / 2);
        }

        return { pathElements, pathIndices };
    }
}
```

## Security Considerations

### Path Index Validation

**Critical**: Path indices must be binary (0 or 1). The circuit enforces this:

```circom
path_index[i] * (path_index[i] - 1) === 0;
```

**Attack scenario** without this check:

- Attacker provides `path_index = 2`
- Could manipulate hash order
- Create false proof of membership

### Root Freshness

The circuit only verifies that a leaf was in _some_ tree with the given root. The runtime must check:

1. **Current root**: Is this the latest state?
2. **Historic roots**: Is this a recent root (within N blocks)?

```rust
pub fn is_valid_root(root: FieldElement) -> bool {
    // Check current root
    if root == CurrentMerkleRoot::get() {
        return true;
    }

    // Check recent historic roots (last 100 blocks)
    HistoricRoots::get()
        .iter()
        .take(100)
        .any(|historic| *historic == root)
}
```

**Why allow historic roots?**

- Prevents front-running attacks
- Gives users time to generate proofs
- Typical: Allow roots from last 100 blocks

### Zero Leaf Handling

**Issue**: Unused leaves are padded with `0`. An attacker could prove membership of `0`.

**Solution**: Never accept `leaf = 0` as valid:

```rust
if leaf == 0 {
    return Err("Zero leaf not allowed");
}
```

### Tree Depth Trade-offs

| Depth | Capacity      | Proof Size | Constraints | Verification Cost |
| ----- | ------------- | ---------- | ----------- | ----------------- |
| 10    | 1,024         | 320 bytes  | ~1,550      | Low               |
| 20    | 1,048,576     | 640 bytes  | ~3,100      | Medium            |
| 30    | 1,073,741,824 | 960 bytes  | ~4,650      | High              |

**Recommendation**: Depth 20 balances capacity and efficiency for most use cases.

## Implementation Notes

### Sparse vs Dense Trees

**Dense Tree** (current implementation):

- All leaves are stored
- Simple proof generation
- Higher storage cost

**Sparse Merkle Tree**:

- Only non-zero nodes stored
- More complex proof generation
- Lower storage cost
- Better for large trees with few leaves

### Incremental Tree Updates

For efficient on-chain updates:

```rust
// Only update path from leaf to root
pub fn update_leaf(index: usize, new_leaf: FieldElement) {
    let mut current = new_leaf;
    let mut idx = index;

    for level in 0..TREE_DEPTH {
        let sibling = get_sibling(level, idx);

        let parent = if idx % 2 == 0 {
            poseidon_hash(&[current, sibling])
        } else {
            poseidon_hash(&[sibling, current])
        };

        store_node(level + 1, idx / 2, parent);
        current = parent;
        idx /= 2;
    }

    // Update root
    set_root(current);
}
```

### Caching Strategy

For wallet/indexer implementations:

```typescript
// Cache Merkle proofs for user's notes
interface CachedProof {
    commitment: bigint;
    leafIndex: number;
    proof: MerkleProof;
    rootAtProof: bigint;
    blockNumber: number;
}

// Update proofs when tree changes
function updateProofs(newRoot: bigint, newLeaves: bigint[]): void {
    // Recompute proofs for affected leaves
    // Keep old proofs if they're still valid (historic roots)
}
```

## Performance Optimization

### Batch Verification

Verify multiple proofs in one circuit:

```circom
template BatchMerkleVerifier(levels, batch_size) {
    signal input leaves[batch_size];
    signal input path_elements[batch_size][levels];
    signal input path_index[batch_size][levels];
    signal input root;

    component verifiers[batch_size];

    for (var i = 0; i < batch_size; i++) {
        verifiers[i] = MerkleTreeVerifier(levels);
        verifiers[i].leaf <== leaves[i];
        // ... assign path elements and indices

        verifiers[i].root === root;
    }
}
```

**Benefit**: Amortize verification cost over multiple proofs.

### Poseidon Optimization

Use efficient Poseidon implementation:

- `Poseidon2` for binary trees (2 inputs)
- Optimized constants for your field
- Hardware acceleration if available

## Testing

Run Merkle tree tests:

```bash
npm test -- test/merkle_tree.test.ts
```

Tests cover:

- Single leaf verification
- Multiple leaf verification
- Invalid proof rejection
- Edge cases (index 0, max index)
- Empty tree handling

## Common Issues

### Issue: Proof Verification Failed

**Cause**: Incorrect path computation

**Debug**:

```typescript
// Log each step
let current = leaf;
for (let i = 0; i < pathElements.length; i++) {
    console.log(
        `Level ${i}: current=${current}, sibling=${pathElements[i]}, index=${pathIndices[i]}`
    );

    if (pathIndices[i] === 0) {
        current = poseidon([current, pathElements[i]]);
    } else {
        current = poseidon([pathElements[i], current]);
    }
}
console.log(`Final root: ${current}, Expected: ${expectedRoot}`);
```

### Issue: Wrong Leaf Index

**Cause**: Using commitment value as index instead of position

**Solution**:

```typescript
// ❌ Wrong
const proof = tree.getProof(commitment);

// ✅ Correct
const leafIndex = tree.getLeafIndex(commitment);
const proof = tree.getProof(leafIndex);
```

### Issue: Stale Merkle Root

**Cause**: Using old root after tree updates

**Solution**: Always fetch latest root before generating proof

```typescript
const currentRoot = await fetchCurrentRoot();
const proof = tree.getProof(leafIndex);

// Verify root matches
if (tree.root !== currentRoot) {
    throw new Error("Tree out of sync");
}
```

## Standards Compliance

This implementation follows:

- **Poseidon-based Merkle trees**: Similar to Tornado Cash, Hermez, Aztec
- **Binary tree structure**: Standard left/right sibling approach
- **Zero-padding**: Standard practice for incomplete levels

## Future Enhancements

### Sparse Merkle Tree

Benefits:

- Constant-size proofs of non-membership
- More efficient for large, sparse trees
- Requires subtree caching

### Merkle Mountain Ranges

Benefits:

- Append-only structure
- No need for tree rebalancing
- Efficient for grow-only commitment sets

### SNARK-Friendly Accumulators

Alternatives to Merkle trees:

- **RSA accumulators**: Constant-size proofs
- **Verkle trees**: Smaller proofs with different trade-offs

## Related Documentation

- [Note Circuit](note.md) - Commitments stored in the tree
- [Transfer Circuit](transfer.md) - Uses MerkleTreeVerifier
- [Unshield Circuit](unshield.md) - Uses MerkleTreeVerifier
- [Poseidon Wrapper](poseidon-wrapper.md) - Hash function used
