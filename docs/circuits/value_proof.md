# Value Proof Circuit

**File**: [`circuits/value_proof.circom`](../../circuits/value_proof.circom)

## Purpose

The Value Proof circuit lets a relayer **prove that a note commitment encodes exactly the declared amount** before the runtime inserts it into the Merkle tree and credits relay fees.

Used by `pallet-shielded-pool::claim_shielded_fees`. Without this proof, a relayer could craft a commitment encoding an inflated value (e.g. 10× the pending fees) and later `unshield` that inflated amount, draining other users' funds.

## Circuit Statement

> "I know a note preimage `(value, asset_id, owner_pubkey, blinding)` such that `Poseidon(value, asset_id, owner_pubkey, blinding) == commitment`. The declared public `value` and `asset_id` match that preimage exactly."

## Security Properties

- **Soundness**: Cannot supply a commitment built with a different value than the one declared in the public signals.
- **Privacy**: `owner_pubkey` remains private; only its Poseidon hash is revealed, preventing linkage to the Baby Jubjub key.
- **Inflation prevention**: The circuit enforces `commitment == NoteCommitment(value, ...)` — a relayer cannot claim `value=10000` if the commitment was built with `value=1000`.
- **No spending key required**: Proves note formation only, not ownership or Merkle membership.

## Public Inputs

| Signal       | Type  | On-chain bytes | Description                              |
| ------------ | ----- | -------------- | ---------------------------------------- |
| `commitment` | Field | `[0..32]`      | Note commitment (inserted into the tree) |
| `value`      | Field | `[32..40]`     | Declared relay fee amount (u64 LE)       |
| `asset_id`   | Field | `[40..44]`     | Asset identifier (u32 LE)                |

## Public Outputs

| Signal       | Type  | On-chain bytes | Description                               |
| ------------ | ----- | -------------- | ----------------------------------------- |
| `owner_hash` | Field | `[44..76]`     | `Poseidon(owner_pubkey)` — auxiliary hash |

**On-chain public signals layout (76 bytes total):**

```
commitment[0..32] | value[32..40] | asset_id[40..44] | owner_hash[44..76]
```

The runtime enforces:

1. `public_signals[0..32] == commitment` (arg match)
2. `public_signals[32..40] == amount` (value match, u64 LE)
3. `public_signals[40..44] == asset_id` (asset match, u32 LE)

`owner_hash` is available for off-chain audit but is not enforced by the pallet.

## Private Inputs

| Signal         | Type  | Description                               |
| -------------- | ----- | ----------------------------------------- |
| `owner_pubkey` | Field | Owner's Baby Jubjub public key (Ax)       |
| `blinding`     | Field | Random blinding factor for the commitment |

## Constraints

### 1. Commitment Verification

```circom
component note_commitment = NoteCommitment();
note_commitment.value        <== value;
note_commitment.asset_id     <== asset_id;
note_commitment.owner_pubkey <== owner_pubkey;
note_commitment.blinding     <== blinding;
note_commitment.commitment   === commitment;
```

Expands to:

```
commitment == Poseidon(value, asset_id, owner_pubkey, blinding)
```

### 2. Owner Hash

```circom
component hasher = Poseidon(1);
hasher.inputs[0] <== owner_pubkey;
owner_hash <== hasher.out;
```

```
owner_hash = Poseidon(owner_pubkey)
```

## Circuit Parameters

- **Constraints**: ~300 (estimate — depends on Poseidon round constants)
- **Public Inputs**: 3
- **Public Outputs**: 1
- **Private Inputs**: 2
- **Proving Time**: <50 ms (local machine)
- **Verification Time**: <5 ms
- **CircuitId (runtime)**: `6` (`CircuitId::VALUE_PROOF`)

## Comparison with Other Circuits

| Property              | value_proof | unshield |
| --------------------- | ----------- | -------- |
| Merkle proof          | No          | Yes      |
| Spending key          | No          | Yes      |
| Nullifier             | No          | Yes      |
| Proves note formation | Yes         | Implicit |
| Proves ownership      | No          | Yes      |
| ECDH encryption       | No          | No       |

## Usage Example

```typescript
import { buildPoseidon } from "circomlibjs";

const poseidon = await buildPoseidon();
const F = poseidon.F;

const value = 1000n;
const asset_id = 0n;
const ownerPubkey = myBabyJubKeyAx;
const blinding = crypto.randomBytes(31).readBigUInt64BE();

const commitment = BigInt(F.toString(poseidon([value, asset_id, ownerPubkey, blinding])));

const input = {
    // Public inputs
    commitment: commitment.toString(),
    value: value.toString(),
    asset_id: asset_id.toString(),
    // Private inputs
    owner_pubkey: ownerPubkey.toString(),
    blinding: blinding.toString(),
};

// Generate proof (proof-generator or snarkjs)
// const { proof, publicSignals } = await groth16.fullProve(input, wasmPath, zkeyPath);
```

## Inflation Attack Prevention

Without this proof, the following attack is possible:

1. Relayer has 1,000 pending fees for asset 0.
2. Relayer builds `commitment = Poseidon(10_000, 0, pk, r)` (inflated value).
3. Relayer calls `claim_shielded_fees(amount=1_000, commitment=...)`.
4. Runtime credits only 1,000 from the pool balance but inserts a note worth 10,000.
5. Relayer calls `unshield(commitment)` and withdraws 10,000 — stealing 9,000 from other users.

With `value_proof`, step 3 requires a valid Groth16 proof where `commitment` was built with `value=1_000`. The circuit constraint `commitment === NoteCommitment(1_000, ...)` makes it impossible to supply a commitment built for 10,000 while declaring 1,000.
