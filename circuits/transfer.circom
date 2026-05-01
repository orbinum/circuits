pragma circom 2.0.0;

include "./note.circom";
include "./merkle_tree.circom";
include "../node_modules/circomlib/circuits/babyjub.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Private transfer: 2 input notes → 2 output notes.
// Supports dummy inputs (input_values[i] == 0): Merkle and nullifier derivation checks
// are skipped for dummy inputs. The dummy nullifier is forced to zero by the circuit.
// Ownership is proven via BabyPbk(spending_key) → ownerPk (Constraint 3), which replaces
// EdDSA and saves ~7,000 R1CS constraints.
// The fee is paid to the block author (validator) by the pallet runtime.
template Transfer(tree_depth) {
    // Public inputs
    signal input merkle_root;
    signal input nullifiers[2];
    signal input commitments[2];
    signal input asset_id;  // asset being transferred (must match input notes)
    signal input fee;       // gasless fee deducted from input sum; paid to block author

    // Private inputs — input notes (being spent)
    signal input input_values[2];
    signal input input_asset_ids[2];
    signal input input_blindings[2];
    signal input spending_keys[2];

    // Merkle proofs for input notes
    signal input input_path_elements[2][tree_depth];
    signal input input_path_indices[2][tree_depth];

    // Private inputs — output notes (being created)
    signal input output_values[2];
    signal input output_asset_ids[2];
    signal input output_owner_pubkeys[2];
    signal input output_blindings[2];

    // Determine which inputs are dummy (value == 0).
    // is_dummy[i].out == 1 iff input_values[i] == 0. Dummy inputs bypass
    // Merkle membership, nullifier derivation, and EdDSA signature checks.
    component is_dummy[2];
    for (var i = 0; i < 2; i++) {
        is_dummy[i] = IsZero();
        is_dummy[i].in <== input_values[i];
    }

    // Constraint 3: derive owner public keys from spending_keys via BabyJubJub scalar multiplication
    // (BabyPbk). This proves the prover knows the discrete log of the ownerPk embedded in each
    // input note commitment, making a separate EdDSA signature unnecessary. Saves ~7,000 R1CS
    // constraints vs EdDSA (2 × ~3,500 EdDSA) at the cost of 2 × ~2,500 BabyPbk = ~5,000.
    // Defined here because the derived Ax is needed in Constraint 1 (NoteCommitment).
    component key_derivation[2];
    for (var i = 0; i < 2; i++) {
        key_derivation[i] = BabyPbk();
        key_derivation[i].in <== spending_keys[i];
    }

    // Constraint 1: each real input commitment exists in the Merkle tree.
    // Dummy inputs (value == 0) are exempt from the Merkle check.
    // owner_pubkey is the Ax component of the BabyJubJub public key derived from spending_key.
    signal input_owner_pubkeys[2];
    input_owner_pubkeys[0] <== key_derivation[0].Ax;
    input_owner_pubkeys[1] <== key_derivation[1].Ax;

    component input_commitments[2];
    component merkle_verifiers[2];
    signal merkle_diffs[2];

    for (var i = 0; i < 2; i++) {
        input_commitments[i] = NoteCommitment();
        input_commitments[i].value <== input_values[i];
        input_commitments[i].asset_id <== input_asset_ids[i];
        input_commitments[i].owner_pubkey <== input_owner_pubkeys[i];
        input_commitments[i].blinding <== input_blindings[i];

        merkle_verifiers[i] = MerkleTreeVerifier(tree_depth);
        merkle_verifiers[i].leaf <== input_commitments[i].commitment;

        for (var j = 0; j < tree_depth; j++) {
            merkle_verifiers[i].path_elements[j] <== input_path_elements[i][j];
            merkle_verifiers[i].path_index[j] <== input_path_indices[i][j];
        }

        // Real inputs must be in the tree; dummy inputs (value == 0) are exempt
        merkle_diffs[i] <== merkle_verifiers[i].root - merkle_root;
        merkle_diffs[i] * (1 - is_dummy[i].out) === 0;
    }

    // Constraint 2: nullifiers must equal Poseidon(commitment, spending_key).
    // Dummy inputs (value == 0) are exempt; their nullifier must be zero (see Constraint 9).
    component nullifier_computers[2];
    signal nullifier_diffs[2];

    for (var i = 0; i < 2; i++) {
        nullifier_computers[i] = Nullifier();
        nullifier_computers[i].commitment <== input_commitments[i].commitment;
        nullifier_computers[i].spending_key <== spending_keys[i];

        // Only enforce nullifier derivation for real (non-dummy) inputs
        nullifier_diffs[i] <== nullifier_computers[i].nullifier - nullifiers[i];
        nullifier_diffs[i] * (1 - is_dummy[i].out) === 0;
    }

    // Constraint 4: output commitments match Poseidon(value, asset_id, owner_pubkey, blinding)
    component output_commitment_computers[2];

    for (var i = 0; i < 2; i++) {
        output_commitment_computers[i] = NoteCommitment();
        output_commitment_computers[i].value <== output_values[i];
        output_commitment_computers[i].asset_id <== output_asset_ids[i];
        output_commitment_computers[i].owner_pubkey <== output_owner_pubkeys[i];
        output_commitment_computers[i].blinding <== output_blindings[i];

        output_commitment_computers[i].commitment === commitments[i];
    }

    // Constraint 5: sum(input values) == sum(output values) + fee
    signal input_sum;
    signal output_sum;

    input_sum <== input_values[0] + input_values[1];
    output_sum <== output_values[0] + output_values[1];

    input_sum === output_sum + fee;

    // Constraint 6: all values must fit in u128 (matches runtime Balance type)
    component input_range_checks[2];
    component output_range_checks[2];

    for (var i = 0; i < 2; i++) {
        input_range_checks[i] = Num2Bits(128);
        input_range_checks[i].in <== input_values[i];

        output_range_checks[i] = Num2Bits(128);
        output_range_checks[i].in <== output_values[i];
    }

    // Constraint 6b: fee must fit in u128 (defense-in-depth; circuit is self-contained)
    component fee_range_check = Num2Bits(128);
    fee_range_check.in <== fee;

    // Constraint 7: all input and output notes must use the same asset_id
    input_asset_ids[0] === input_asset_ids[1];
    input_asset_ids[0] === output_asset_ids[0];
    input_asset_ids[0] === output_asset_ids[1];

    // Constraint 8: public asset_id must match the notes' asset_id
    asset_id === input_asset_ids[0];

    // Constraint 9: nullifier of a dummy input must be zero
    // (a prover cannot claim a real nullifier while bypassing membership checks)
    for (var i = 0; i < 2; i++) {
        nullifiers[i] * is_dummy[i].out === 0;
    }

    // Constraint 10: if both inputs are real, their nullifiers must be distinct
    // (prevents double-spending the same note in a single transaction;
    // without this a prover can set input[0]=input[1] and get 2×value from one note
    // while conservation holds and both pallet checks pass before insert)
    signal both_real;
    both_real <== (1 - is_dummy[0].out) * (1 - is_dummy[1].out);

    component nullifiers_equal = IsZero();
    nullifiers_equal.in <== nullifiers[0] - nullifiers[1];

    signal must_be_distinct;
    must_be_distinct <== nullifiers_equal.out * both_real;
    must_be_distinct === 0;
}

// 2 inputs, 2 outputs, 20-level tree (matches pallet MAX_TREE_DEPTH)
component main {public [merkle_root, nullifiers, commitments, asset_id, fee]} = Transfer(20);
