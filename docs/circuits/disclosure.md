# Selective Disclosure Circuit

**File**: [`circuits/disclosure.circom`](../../circuits/disclosure.circom)

## Purpose

The Selective Disclosure circuit lets a note owner prove ownership and **selectively reveal** specific fields (value, asset ID, or owner) to a designated auditor — without leaking anything to third parties. The revealed data is **encrypted on-circuit** using ECDH over Baby Jubjub + Poseidon, so only the auditor can decrypt.

## Circuit Statement

> "I know a note that generates this commitment. I encrypt the chosen fields with the auditor's Baby Jubjub public key using ephemeral scalar r, and produce a verifiable ciphertext."

## Security Properties

- **Soundness**: Cannot forge a proof without knowing the actual note data.
- **Privacy**: Only the designated auditor can decrypt the revealed fields (ECDH key agreement).
- **Binding**: Proof is bound to a specific commitment on-chain.
- **Auditor-specific**: Different auditor → different public key → different ephemeral shared secret → auditors cannot decrypt each other's disclosures.
- **Non-malleable r**: `r` is private; changing it produces a different ciphertext — verifier cannot reuse a proof for a different auditor.

## Public Inputs

| Signal         | Type  | Description                                   |
| -------------- | ----- | --------------------------------------------- |
| `commitment`   | Field | Note commitment (must exist on-chain)         |
| `auditor_pk_x` | Field | Auditor Baby Jubjub public key — x coordinate |
| `auditor_pk_y` | Field | Auditor Baby Jubjub public key — y coordinate |

## Public Outputs (Ciphertext)

| Signal           | Type  | Description                                         |
| ---------------- | ----- | --------------------------------------------------- |
| `epk_x`          | Field | Ephemeral public key — x coordinate (`r·G`)         |
| `epk_y`          | Field | Ephemeral public key — y coordinate (`r·G`)         |
| `enc_value`      | Field | Encrypted value (`value_or_0 + k₀ mod p`)           |
| `enc_asset_id`   | Field | Encrypted asset ID (`asset_id_or_0 + k₁ mod p`)     |
| `enc_owner_hash` | Field | Encrypted owner hash (`owner_hash_or_0 + k₂ mod p`) |

## Private Inputs

| Signal              | Type  | Description                                       |
| ------------------- | ----- | ------------------------------------------------- |
| `value`             | Field | Actual note value                                 |
| `asset_id`          | Field | Actual asset ID                                   |
| `owner_pubkey`      | Field | Owner's public key                                |
| `blinding`          | Field | Blinding factor for commitment                    |
| `disclose_value`    | bool  | 1 = encrypt value, 0 = encrypt 0                  |
| `disclose_asset_id` | bool  | 1 = encrypt asset_id, 0 = encrypt 0               |
| `disclose_owner`    | bool  | 1 = encrypt Poseidon(owner_pubkey), 0 = encrypt 0 |
| `r`                 | Field | Ephemeral scalar (random, BN254 scalar field)     |

## Constraints

### 1. Commitment Verification

```
commitment == Poseidon(value, asset_id, owner_pubkey, blinding)
```

### 2. Boolean Disclosure Masks

```circom
disclose_value    * (disclose_value    - 1) === 0;
disclose_asset_id * (disclose_asset_id - 1) === 0;
disclose_owner    * (disclose_owner    - 1) === 0;
```

### 3. Selective Field Selection

```
plain_value      = disclose_value    ? value                  : 0
plain_asset_id   = disclose_asset_id ? asset_id               : 0
plain_owner_hash = disclose_owner    ? Poseidon(owner_pubkey) : 0
```

### 4. ECDH Key Agreement (Baby Jubjub)

```
epk    = r · G     (EscalarMulFix, base point G = Base8)
shared = r · pk_A  (EscalarMulAny, auditor public key)
```

**Base point G (Base8)**:

```
Gx = 5299619240641551281634865583518297030282874472190772894086521144482721001553
Gy = 16950150798460657717958625567821834550301663161624707787222815936182638968203
```

### 5. Poseidon Keystream

```
k₀ = Poseidon(shared.x, shared.y, 0)
k₁ = Poseidon(shared.x, shared.y, 1)
k₂ = Poseidon(shared.x, shared.y, 2)
```

### 6. Field Encryption (mod p addition)

```
enc_value      = plain_value      + k₀  (mod BN254 prime p)
enc_asset_id   = plain_asset_id   + k₁  (mod BN254 prime p)
enc_owner_hash = plain_owner_hash + k₂  (mod BN254 prime p)
```

## Circuit Parameters

- **Constraints**: ~9,411 (7,557 non-linear + 1,854 linear)
- **Public Inputs**: 3
- **Public Outputs**: 5
- **Private Inputs**: 8
- **Proving Time**: ~1–2 s (local machine)
- **Verification Time**: ~5 ms

## Decryption (Off-Chain)

The auditor decrypts using their spending key `sk_A`:

```typescript
import { buildBabyjub, buildPoseidon } from "circomlibjs";

const BN254_P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

async function decrypt(
    sk_A: bigint,
    epk_x: bigint,
    epk_y: bigint,
    enc_value: bigint,
    enc_asset_id: bigint,
    enc_owner_hash: bigint
) {
    const babyJub = await buildBabyjub();
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    // Shared secret: sk_A · epk
    const epkPoint = [babyJub.F.e(epk_x.toString()), babyJub.F.e(epk_y.toString())];
    const shared = babyJub.mulPointEscalar(epkPoint, sk_A);
    const sx = BigInt(babyJub.F.toString(shared[0]));
    const sy = BigInt(babyJub.F.toString(shared[1]));

    // Keystream
    const k0 = BigInt(F.toString(poseidon([sx, sy, 0n])));
    const k1 = BigInt(F.toString(poseidon([sx, sy, 1n])));
    const k2 = BigInt(F.toString(poseidon([sx, sy, 2n])));

    // Decrypt (field subtraction mod p)
    const sub = (enc: bigint, k: bigint) => (enc - k + BN254_P) % BN254_P;

    return {
        value: sub(enc_value, k0), // 0 if field not disclosed
        asset_id: sub(enc_asset_id, k1), // 0 if field not disclosed
        owner_hash: sub(enc_owner_hash, k2), // 0 if field not disclosed
    };
}
```

**Note**: A decrypted result of `0` means the field was not disclosed. The auditor cannot distinguish "value is 0" from "value was hidden" without a separate proof — this is intentional.

## Usage Examples

### Reveal Value Only

```typescript
const input = {
    // Public inputs
    commitment: noteCommitment,
    auditor_pk_x: auditorKey.x.toString(),
    auditor_pk_y: auditorKey.y.toString(),

    // Private inputs
    value: note.value.toString(),
    asset_id: note.assetId.toString(),
    owner_pubkey: note.ownerPubkey.toString(),
    blinding: note.blinding.toString(),
    disclose_value: "1",
    disclose_asset_id: "0",
    disclose_owner: "0",
    r: ephemeralScalar.toString(),
};
// Outputs: epk_x, epk_y, enc_value (real), enc_asset_id (zero-masked), enc_owner_hash (zero-masked)
```

### Reveal All Fields

```typescript
const input = {
    commitment: noteCommitment,
    auditor_pk_x: auditorKey.x.toString(),
    auditor_pk_y: auditorKey.y.toString(),
    value: note.value.toString(),
    asset_id: note.assetId.toString(),
    owner_pubkey: note.ownerPubkey.toString(),
    blinding: note.blinding.toString(),
    disclose_value: "1",
    disclose_asset_id: "1",
    disclose_owner: "1",
    r: ephemeralScalar.toString(),
};
```

### Zero-Knowledge Proof of Ownership (Nothing Revealed)

```typescript
const input = {
    commitment: noteCommitment,
    auditor_pk_x: auditorKey.x.toString(),
    auditor_pk_y: auditorKey.y.toString(),
    value: note.value.toString(),
    asset_id: note.assetId.toString(),
    owner_pubkey: note.ownerPubkey.toString(),
    blinding: note.blinding.toString(),
    disclose_value: "0",
    disclose_asset_id: "0",
    disclose_owner: "0",
    r: ephemeralScalar.toString(),
};
// All enc_* outputs contain only keystream noise — auditor learns nothing.
```

## Use Cases

1. **Compliance Auditing**: Reveal value and asset to a regulator without exposing the owner.
2. **Selective Tax Reporting**: Reveal value and asset for a specific jurisdiction's auditor.
3. **Ownership Proof**: Prove note ownership to a counterparty without revealing amount.
4. **Private Escrow Dispute**: Reveal all fields to an arbitrator under ECDH confidentiality.
5. **Multi-Auditor**: Generate separate proofs with different `r` and `auditor_pk` for each auditor.

## Security Considerations

### Ephemeral Scalar r

- `r` MUST be sampled uniformly at random from the BN254 scalar field for each proof.
- Reusing `r` with the same `auditor_pk` leaks the same `epk` and shared secret — breaking ciphertext unlinkability.

### Auditor Public Key Validation

- The circuit does NOT verify that `auditor_pk` is a valid Baby Jubjub point (this would cost ~2,500 extra constraints). The prover is responsible for using a valid curve point.
- An invalid point causes `EscalarMulAny` to produce an incorrect result, invalidating the ciphertext but not breaking soundness.

### Owner Hash vs Raw Pubkey

- When `disclose_owner=1`, the circuit encrypts `Poseidon(owner_pubkey)`, not the raw pubkey. This prevents the auditor from recovering the pubkey even with a weak shared secret.

### Commitment Validation

The runtime SHOULD verify before accepting a disclosure proof:

1. The commitment exists in the on-chain Merkle tree.
2. The commitment has not been nullified (note not spent).

## Implementation Notes

Circom includes used:

- `circomlib/circuits/poseidon.circom` — Poseidon hash (2-input and 4-input)
- `circomlib/circuits/bitify.circom` — `Num2Bits(253)` for scalar `r`
- `circomlib/circuits/escalarmulfix.circom` — `epk = r·G`
- `circomlib/circuits/escalarmulany.circom` — `shared = r·pk_A`
