pragma circom 2.0.0;

include "./spend.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Unshield: a private note is withdrawn to a public account.
//
// A partial withdrawal returns the rest as a change note:
// note_value === amount + fee + change_value. With change_value == 0 the
// change_commitment must be 0 and the pallet inserts nothing; otherwise it
// must be the change note's commitment and the pallet inserts it.
template Unshield(tree_depth) {
    // Public inputs
    signal input merkle_root;
    signal input nullifier;
    signal input amount;             // what the recipient receives
    signal input recipient;          // blake2_256(AccountId32) mod r; non-zero checked by the pallet
    signal input asset_id;
    signal input fee;                // relay fee, deducted from the note
    signal input change_commitment;  // 0 for a total withdrawal
    signal input memo_hash;          // blake2_256(SCALE(change memo)) mod r

    // Private inputs — the spent note
    signal input note_value;
    signal input note_asset_id;
    signal input note_blinding;
    signal input spending_key;
    signal input path_elements[tree_depth];
    signal input path_indices[tree_depth];

    // Private inputs — the change note (ignored when change_value == 0)
    signal input change_value;
    signal input change_blinding;
    signal input change_owner_pubkey;

    // ── 1 · The spent note: ownership, membership, nullifier ─────────────────
    component spent = SpentNote(tree_depth);
    spent.value <== note_value;
    spent.asset_id <== note_asset_id;
    spent.blinding <== note_blinding;
    spent.spending_key <== spending_key;
    for (var i = 0; i < tree_depth; i++) {
        spent.path_elements[i] <== path_elements[i];
        spent.path_index[i] <== path_indices[i];
    }
    spent.root === merkle_root;
    spent.nullifier === nullifier;

    // ── 2 · Conservation of value ─────────────────────────────────────────────
    note_value === amount + fee + change_value;

    // ── 3 · Ranges ────────────────────────────────────────────────────────────
    // Every amount fits u128 (the runtime's Balance), so the sum above cannot
    // wrap around the field whatever the caller passes.
    component value_range_check = Num2Bits(128);
    value_range_check.in <== note_value;
    component amount_range_check = Num2Bits(128);
    amount_range_check.in <== amount;
    component fee_range_check = Num2Bits(128);
    fee_range_check.in <== fee;
    component change_range_check = Num2Bits(128);
    change_range_check.in <== change_value;

    // ── 4 · One asset ─────────────────────────────────────────────────────────
    note_asset_id === asset_id;

    // ── 5 · The change note ───────────────────────────────────────────────────
    // has_no_change.out == 1 iff change_value == 0. The commitment is computed
    // either way (constraints always run) and bound only when there is change.
    component has_no_change = IsZero();
    has_no_change.in <== change_value;

    component change = NoteCommitment();
    change.value <== change_value;
    change.asset_id <== note_asset_id;
    change.owner_pubkey <== change_owner_pubkey;
    change.blinding <== change_blinding;

    signal change_diff;
    change_diff <== change.commitment - change_commitment;
    change_diff * (1 - has_no_change.out) === 0;
    change_commitment * has_no_change.out === 0;

    // ── 6 · Memo and recipient binding ────────────────────────────────────────
    // The memo carries the change note's secrets but is not otherwise part of
    // the statement, so a copier could swap it. The recipient gets a constraint
    // of its own rather than relying on the setup to bind an unused input. The
    // squares keep the signals from being optimised away.
    signal memo_hash_sq;
    memo_hash_sq <== memo_hash * memo_hash;
    signal recipient_sq;
    recipient_sq <== recipient * recipient;
}

// 20-level tree (matches the pallet's MAX_TREE_DEPTH)
component main {public [merkle_root, nullifier, amount, recipient, asset_id, fee, change_commitment, memo_hash]} = Unshield(20);
