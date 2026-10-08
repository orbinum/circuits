pragma circom 2.0.0;

include "./note.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Private transfer: two input notes become two output notes.
//
// Each input is proven against its own Merkle root, so the two notes may come
// from different trees of the forest. An input of value 0 is a dummy that pads
// a one-note spend: it proves no membership and its nullifier is zero. The
// pallet pays the fee to the relayer that committed to the spend, else to the
// block author.
template Transfer(tree_depth) {
    // Public inputs
    signal input merkle_roots[2]; // the root input i is proven against
    signal input nullifiers[2];
    signal input commitments[2];
    signal input asset_id;        // must match every note
    signal input fee;             // relay fee, deducted from the inputs
    signal input memo_hash;       // blake2_256(SCALE(output memos)) mod r

    // Private inputs — input notes
    signal input input_values[2];
    signal input input_asset_ids[2];
    signal input input_blindings[2];
    signal input spending_keys[2];
    signal input input_path_elements[2][tree_depth];
    signal input input_path_indices[2][tree_depth];

    // Private inputs — output notes
    signal input output_values[2];
    signal input output_asset_ids[2];
    signal input output_owner_pubkeys[2];
    signal input output_blindings[2];

    // ── 1 · Dummy inputs ──────────────────────────────────────────────────────
    // is_dummy[i].out == 1 iff input_values[i] == 0.
    component is_dummy[2];
    for (var i = 0; i < 2; i++) {
        is_dummy[i] = IsZero();
        is_dummy[i].in <== input_values[i];
    }

    // ── 2 · Input notes: ownership, membership, nullifiers ───────────────────
    // A real input sits in the tree behind merkle_roots[i] and reveals its
    // nullifier. A dummy's root and nullifier are left free here; section 7
    // pins the nullifier to zero and the pallet pins the root.
    component spent[2];
    signal root_diffs[2];
    signal nullifier_diffs[2];
    for (var i = 0; i < 2; i++) {
        spent[i] = SpentNote(tree_depth);
        spent[i].value <== input_values[i];
        spent[i].asset_id <== input_asset_ids[i];
        spent[i].blinding <== input_blindings[i];
        spent[i].spending_key <== spending_keys[i];
        for (var j = 0; j < tree_depth; j++) {
            spent[i].path_elements[j] <== input_path_elements[i][j];
            spent[i].path_index[j] <== input_path_indices[i][j];
        }

        root_diffs[i] <== spent[i].root - merkle_roots[i];
        root_diffs[i] * (1 - is_dummy[i].out) === 0;

        nullifier_diffs[i] <== spent[i].nullifier - nullifiers[i];
        nullifier_diffs[i] * (1 - is_dummy[i].out) === 0;
    }

    // ── 3 · Output notes ──────────────────────────────────────────────────────
    component outputs[2];
    for (var i = 0; i < 2; i++) {
        outputs[i] = NoteCommitment();
        outputs[i].value <== output_values[i];
        outputs[i].asset_id <== output_asset_ids[i];
        outputs[i].owner_pubkey <== output_owner_pubkeys[i];
        outputs[i].blinding <== output_blindings[i];
        outputs[i].commitment === commitments[i];
    }

    // ── 4 · Conservation of value ─────────────────────────────────────────────
    signal input_sum;
    signal output_sum;
    input_sum <== input_values[0] + input_values[1];
    output_sum <== output_values[0] + output_values[1];
    input_sum === output_sum + fee;

    // ── 5 · Ranges ────────────────────────────────────────────────────────────
    // Every amount fits u128 (the runtime's Balance), so the sums above cannot
    // wrap around the field.
    component input_range_checks[2];
    component output_range_checks[2];
    for (var i = 0; i < 2; i++) {
        input_range_checks[i] = Num2Bits(128);
        input_range_checks[i].in <== input_values[i];
        output_range_checks[i] = Num2Bits(128);
        output_range_checks[i].in <== output_values[i];
    }
    component fee_range_check = Num2Bits(128);
    fee_range_check.in <== fee;

    // ── 6 · One asset ─────────────────────────────────────────────────────────
    input_asset_ids[0] === input_asset_ids[1];
    input_asset_ids[0] === output_asset_ids[0];
    input_asset_ids[0] === output_asset_ids[1];
    asset_id === input_asset_ids[0];

    // ── 7 · Dummies reveal nothing; real inputs are distinct notes ────────────
    // A dummy's nullifier is zero, so it cannot name a real note while skipping
    // membership. Two real inputs must be different notes: the same note twice
    // would pass conservation with twice its value.
    for (var i = 0; i < 2; i++) {
        nullifiers[i] * is_dummy[i].out === 0;
    }
    signal both_real;
    both_real <== (1 - is_dummy[0].out) * (1 - is_dummy[1].out);
    component nullifiers_equal = IsZero();
    nullifiers_equal.in <== nullifiers[0] - nullifiers[1];
    signal must_be_distinct;
    must_be_distinct <== nullifiers_equal.out * both_real;
    must_be_distinct === 0;

    // ── 8 · Memo binding ──────────────────────────────────────────────────────
    // The memos carry the output notes' secrets but are not otherwise part of
    // the statement, so a copier could swap them. As a public input the hash is
    // fixed by the proof; the square keeps the signal from being optimised away.
    signal memo_hash_sq;
    memo_hash_sq <== memo_hash * memo_hash;
}

// 2 inputs, 2 outputs, 20-level tree (matches the pallet's MAX_TREE_DEPTH)
component main {public [merkle_roots, nullifiers, commitments, asset_id, fee, memo_hash]} = Transfer(20);
