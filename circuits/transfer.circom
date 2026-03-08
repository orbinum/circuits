pragma circom 2.0.0;

include "./note.circom";
include "./merkle_tree.circom";
include "../node_modules/circomlib/circuits/eddsaposeidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Private transfer: 2 input notes → 2 output notes.
// Proves Merkle membership, nullifier correctness, EdDSA ownership,
// output commitment correctness, value conservation, and range bounds.
template Transfer(tree_depth) {
    // Public inputs
    signal input merkle_root;
    signal input nullifiers[2];
    signal input commitments[2];

    // Private inputs — input notes (being spent)
    signal input input_values[2];
    signal input input_asset_ids[2];
    signal input input_blindings[2];
    signal input spending_keys[2];

    // EdDSA public keys (Ax, Ay) for each input note owner
    signal input input_owner_Ax[2];
    signal input input_owner_Ay[2];

    // EdDSA signatures (R8x, R8y, S) proving ownership of each input note
    signal input input_sig_R8x[2];
    signal input input_sig_R8y[2];
    signal input input_sig_S[2];

    // Merkle proofs for input notes
    signal input input_path_elements[2][tree_depth];
    signal input input_path_indices[2][tree_depth];

    // Private inputs — output notes (being created)
    signal input output_values[2];
    signal input output_asset_ids[2];
    signal input output_owner_pubkeys[2];
    signal input output_blindings[2];

    // Constraint 1: each input commitment exists in the Merkle tree
    // owner_pubkey is the x-coordinate of the EdDSA public key
    signal input_owner_pubkeys[2];
    input_owner_pubkeys[0] <== input_owner_Ax[0];
    input_owner_pubkeys[1] <== input_owner_Ax[1];

    component input_commitments[2];
    component merkle_verifiers[2];

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

        merkle_verifiers[i].root === merkle_root;
    }

    // Constraint 2: nullifiers must equal Poseidon(commitment, spending_key)
    component nullifier_computers[2];

    for (var i = 0; i < 2; i++) {
        nullifier_computers[i] = Nullifier();
        nullifier_computers[i].commitment <== input_commitments[i].commitment;
        nullifier_computers[i].spending_key <== spending_keys[i];

        nullifier_computers[i].nullifier === nullifiers[i];
    }

    // Constraint 3: EdDSA signature over the note commitment proves ownership
    component eddsa_verifiers[2];

    for (var i = 0; i < 2; i++) {
        eddsa_verifiers[i] = EdDSAPoseidonVerifier();
        eddsa_verifiers[i].enabled <== 1;

        eddsa_verifiers[i].Ax <== input_owner_Ax[i];
        eddsa_verifiers[i].Ay <== input_owner_Ay[i];

        eddsa_verifiers[i].R8x <== input_sig_R8x[i];
        eddsa_verifiers[i].R8y <== input_sig_R8y[i];
        eddsa_verifiers[i].S <== input_sig_S[i];

        eddsa_verifiers[i].M <== input_commitments[i].commitment;
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

    // Constraint 5: sum(input values) == sum(output values)
    signal input_sum;
    signal output_sum;

    input_sum <== input_values[0] + input_values[1];
    output_sum <== output_values[0] + output_values[1];

    input_sum === output_sum;

    // Constraint 6: all values must fit in u128 (matches runtime Balance type)
    component input_range_checks[2];
    component output_range_checks[2];

    for (var i = 0; i < 2; i++) {
        input_range_checks[i] = Num2Bits(128);
        input_range_checks[i].in <== input_values[i];

        output_range_checks[i] = Num2Bits(128);
        output_range_checks[i].in <== output_values[i];
    }

    // Constraint 7: all input and output notes must use the same asset_id
    input_asset_ids[0] === input_asset_ids[1];
    input_asset_ids[0] === output_asset_ids[0];
    input_asset_ids[0] === output_asset_ids[1];
}

// 2 inputs, 2 outputs, 20-level tree (matches pallet MAX_TREE_DEPTH)
component main {public [merkle_root, nullifiers, commitments]} = Transfer(20);
