# Selective Disclosure Circuit

**File**: [`circuits/disclosure.circom`](../../circuits/disclosure.circom)

## Purpose

The Selective Disclosure circuit enables users to prove ownership of a note and selectively reveal specific properties (value, asset ID, or owner) while keeping unrevealed properties cryptographically hidden. This is useful for compliance, auditing, and selective transparency without compromising privacy.

## Circuit Statement

> "I know a note that generates this commitment, and I selectively reveal certain fields according to the disclosure mask"

## Security Properties

- **Soundness**: Cannot forge a proof without knowing the actual note data
- **Privacy**: Unrevealed fields remain cryptographically hidden
- **Binding**: Proof is bound to a specific commitment
- **Viewing Key Protection**: Only the note owner (with viewing key) can generate disclosure proofs

## Public Inputs (Visible On-Chain)

| Input                 | Type  | Description                               |
| --------------------- | ----- | ----------------------------------------- |
| `commitment`          | Field | Note commitment (already exists on-chain) |
| `revealed_value`      | u64   | Revealed amount (0 if hidden)             |
| `revealed_asset_id`   | u32   | Revealed asset ID (0 if hidden)           |
| `revealed_owner_hash` | Field | Hash of owner public key (0 if hidden)    |

## Private Inputs (Known Only to Prover)

| Input               | Type  | Description                                     |
| ------------------- | ----- | ----------------------------------------------- |
| `value`             | u64   | Actual note value                               |
| `asset_id`          | u32   | Actual asset ID                                 |
| `owner_pubkey`      | Field | Owner's public key                              |
| `blinding`          | u256  | Blinding factor for commitment                  |
| `viewing_key`       | Field | Viewing key to prove ownership                  |
| `disclose_value`    | bool  | Disclosure mask: reveal value? (1=yes, 0=no)    |
| `disclose_asset_id` | bool  | Disclosure mask: reveal asset ID? (1=yes, 0=no) |
| `disclose_owner`    | bool  | Disclosure mask: reveal owner? (1=yes, 0=no)    |

## Constraints

### 1. Commitment Verification

Proves that the private note data generates the public commitment.

```
commitment = Poseidon(value, asset_id, owner_pubkey, blinding)
```

**Circuit Logic**:

```circom
component note_commitment = NoteCommitment();
note_commitment.value <== value;
note_commitment.asset_id <== asset_id;
note_commitment.owner_pubkey <== owner_pubkey;
note_commitment.blinding <== blinding;

note_commitment.commitment === commitment;
```

### 2. Viewing Key Verification

Proves that the prover knows the correct viewing key, preventing unauthorized disclosure.

```
viewing_key = Poseidon(owner_pubkey)
```

**Circuit Logic**:

```circom
component vk_hasher = Poseidon(1);
vk_hasher.inputs[0] <== owner_pubkey;

vk_hasher.out === viewing_key;
```

### 3. Boolean Constraints

Ensures disclosure masks are binary (0 or 1).

```circom
disclose_value * (disclose_value - 1) === 0;
disclose_asset_id * (disclose_asset_id - 1) === 0;
disclose_owner * (disclose_owner - 1) === 0;
```

### 4. Selective Reveal - Value

Conditionally reveals or hides the note value.

```
revealed_value = disclose_value ? value : 0
```

**Circuit Logic**:

```circom
component value_selector = Selector();
value_selector.condition <== disclose_value;
value_selector.true_value <== value;
value_selector.false_value <== 0;

revealed_value === value_selector.out;
```

### 5. Selective Reveal - Asset ID

Conditionally reveals or hides the asset ID.

```
revealed_asset_id = disclose_asset_id ? asset_id : 0
```

### 6. Selective Reveal - Owner

Conditionally reveals or hides the owner's identity (as a hash).

```
revealed_owner_hash = disclose_owner ? Poseidon(owner_pubkey) : 0
```

**Note**: The circuit reveals the **hash** of the owner's public key, not the key itself, providing an additional layer of privacy.

## Helper Components

### Selector Template

Implements conditional selection:

```circom
template Selector() {
    signal input condition;      // 0 or 1
    signal input true_value;
    signal input false_value;
    signal output out;

    condition * (condition - 1) === 0;  // Boolean constraint

    signal inv_condition;
    inv_condition <== 1 - condition;

    signal term1;
    signal term2;
    term1 <== condition * true_value;
    term2 <== inv_condition * false_value;

    out <== term1 + term2;
}
```

## Circuit Parameters

- **Constraints**: ~8,500
- **Public Inputs**: 4
- **Private Inputs**: 9
- **Proving Time**: ~500ms (local machine)
- **Verification Time**: ~10ms

## Usage Examples

### Reveal Value Only

```typescript
const input = {
    // Public
    commitment: noteCommitment,
    revealed_value: note.value,
    revealed_asset_id: 0n,
    revealed_owner_hash: 0n,

    // Private
    value: note.value,
    asset_id: note.asset_id,
    owner_pubkey: note.ownerPubkey,
    blinding: note.blinding,
    viewing_key: viewingKey,
    disclose_value: 1,
    disclose_asset_id: 0,
    disclose_owner: 0,
};
```

### Reveal All Fields

```typescript
const ownerHash = poseidon([note.ownerPubkey]);

const input = {
    // Public
    commitment: noteCommitment,
    revealed_value: note.value,
    revealed_asset_id: note.asset_id,
    revealed_owner_hash: ownerHash,

    // Private
    value: note.value,
    asset_id: note.asset_id,
    owner_pubkey: note.ownerPubkey,
    blinding: note.blinding,
    viewing_key: viewingKey,
    disclose_value: 1,
    disclose_asset_id: 1,
    disclose_owner: 1,
};
```

### Hide All Fields (Zero-Knowledge Proof of Ownership)

```typescript
const input = {
    // Public
    commitment: noteCommitment,
    revealed_value: 0n,
    revealed_asset_id: 0n,
    revealed_owner_hash: 0n,

    // Private
    value: note.value,
    asset_id: note.asset_id,
    owner_pubkey: note.ownerPubkey,
    blinding: note.blinding,
    viewing_key: viewingKey,
    disclose_value: 0,
    disclose_asset_id: 0,
    disclose_owner: 0,
};
```

## Use Cases

1. **Compliance Auditing**: Reveal note value to auditors without exposing asset type or owner
2. **Balance Verification**: Prove minimum balance without revealing exact amount
3. **Ownership Proof**: Prove note ownership without revealing any other information
4. **Selective Tax Reporting**: Reveal value and asset for tax purposes while maintaining privacy
5. **Transparent Donations**: Reveal value and owner for donation transparency

## Security Considerations

### Viewing Key Management

The viewing key is derived from the owner's public key:

```
viewing_key = Poseidon(owner_pubkey)
```

**Critical**: The viewing key should be kept secret. Anyone with access to the viewing key can generate disclosure proofs for the note.

### Information Leakage

When revealing fields, consider:

- **Value revealing**: May enable statistical analysis across multiple disclosures
- **Owner revealing**: Only reveals the hash, but repeated disclosures can be linked
- **Asset ID revealing**: May expose investment strategies

### Commitment Binding

The proof is bound to a specific commitment. Ensure the commitment exists on-chain before accepting the disclosure proof.

## Implementation Notes

### Commitment Validation

The runtime should verify that:

1. The commitment exists in the commitment tree
2. The commitment has not been nullified (note hasn't been spent)
3. The revealed values match expected ranges (if applicable)

### Multi-Asset Support

The circuit works with any asset ID. The runtime is responsible for validating:

- Asset ID exists in the registry
- User has authorization to disclose for that asset (if required)

## Performance Optimization

### Constraint Count Analysis

| Section                 | Constraints |
| ----------------------- | ----------- |
| Commitment Verification | ~2,000      |
| Viewing Key Hash        | ~2,000      |
| Boolean Constraints     | 3           |
| Value Selector          | ~1,500      |
| Asset ID Selector       | ~1,500      |
| Owner Hash + Selector   | ~3,500      |
| **Total**               | **~8,500**  |

### Trusted Setup

- **Powers of Tau**: Requires at least 16 (2^16 = 65,536 constraints)
- **Phase 2**: Circuit-specific trusted setup
- **Ceremony**: Can use publicly available Powers of Tau ceremonies

## Testing

Run disclosure circuit tests:

```bash
npm test -- test/disclosure.test.ts
```

Run end-to-end disclosure test:

```bash
npm run test:e2e:disclosure
```

## Build Artifacts

Generate disclosure circuit artifacts:

```bash
npm run build:disclosure
```

This produces:

- `build/disclosure.r1cs`
- `build/disclosure_js/` (witness calculator)
- `keys/disclosure_pk.zkey` (proving key)
- `build/verification_key_disclosure.json`
- `build/disclosure_pk.ark` (Rust proving key, if ark-circom installed)

## Related Documentation

- [Note Circuit](note.md) - NoteCommitment component used internally
- [Poseidon Wrapper](poseidon-wrapper.md) - Hash functions used
- [API: Generate Disclosure Input](../api/generate-disclosure-input.md)
- [API: Generate Disclosure Proof](../api/generate-disclosure-proof.md)
