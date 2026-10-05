# Shield Circuit

Circuit id **3**. Proves that a deposit's note commitment encodes exactly the value and asset being deposited.

## Purpose

`shield` inserts a commitment into the Merkle forest and credits the pool with the deposited amount. Nothing else on-chain ties the two together, so without this proof a depositor could insert a note worth more than they paid and later withdraw the difference from other users' deposits.

The proof closes that gap: the pallet supplies `value` and `asset_id` from the call itself, and the proof shows the commitment opens to them.

## Circuit Statement

> I know `owner_pubkey` and `blinding` such that
> `commitment = Poseidon4(value, asset_id, owner_pubkey, blinding)`.

## Public Inputs (Visible On-Chain)

| Field        | Type  | Source                                       |
| ------------ | ----- | -------------------------------------------- |
| `commitment` | Field | The leaf being inserted                      |
| `value`      | Field | The deposited amount (`u128`), from the call |
| `asset_id`   | Field | The deposited asset (`u32`), from the call   |

Witness order is `commitment, value, asset_id`. Each is encoded as a 32-byte little-endian field element.

## Private Inputs (Known Only to Prover)

| Field          | Type  | Description                       |
| -------------- | ----- | --------------------------------- |
| `owner_pubkey` | Field | BabyJubJub `Ax` of the note owner |
| `blinding`     | Field | Commitment blinding factor        |

## Constraints

One: the [note commitment](note.md) recomputed from the inputs must equal the public `commitment`.

```circom
component note = NoteCommitment();
note.value <== value;
note.asset_id <== asset_id;
note.owner_pubkey <== owner_pubkey;
note.blinding <== blinding;
note.commitment === commitment;
```

There is no range check on `value`: the verifier sets it from the call's `u128` amount, so it can never exceed the range. The value is range-checked again whenever the note is spent, by [transfer](transfer.md) and [unshield](unshield.md).

## What It Does Not Bind

- **The owner.** A commitment to a key the depositor does not hold only locks the depositor's own funds.
- **The memo.** A shield is a signed transaction: nobody can copy it and alter the memo without also paying the deposit.
- **The depositor.** Identified by the transaction's signature, not by the proof.

Nothing new is made public: the commitment, the amount and the asset of a shield are already visible on-chain.

## Circuit Parameters

- **Constraints**: 736
- **Public inputs**: 3
- **Private inputs**: 2
- **Tree depth**: none — the circuit checks the commitment, not its position

## Usage Example

```typescript
const ownerPubkey = note.ownerPubkey(spendingKey);
const commitment = note.commitment(value, assetId, ownerPubkey, blinding);

const input = {
    commitment: commitment.toString(),
    value: value.toString(), // must equal the amount passed to shield
    asset_id: assetId.toString(), // must equal the asset passed to shield
    owner_pubkey: ownerPubkey.toString(),
    blinding: blinding.toString(),
};
```

The wallet already holds `owner_pubkey` and `blinding` when it builds the note, so proving needs no extra state.
