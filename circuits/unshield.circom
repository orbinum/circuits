pragma circom 2.0.0;

include "./note.circom";
include "./merkle_tree.circom";
include "./poseidon_wrapper.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

// Unshield: withdraws a private note to a public account.
// Proves note existence in the Merkle tree, nullifier correctness,
// and that the revealed amount matches the note value.
template Unshield(tree_depth) {
    // Public inputs
    signal input merkle_root;
    signal input nullifier;
    signal input amount;      // net withdrawal amount (recipient receives this)
    signal input recipient;   // recipient address (validated non-zero in runtime)
    signal input asset_id;    // asset being unshielded
    signal input fee;         // gasless fee deducted from note value

    // Private inputs
    signal input note_value;
    signal input note_asset_id;
    signal input note_owner;
    signal input note_blinding;
    signal input spending_key;

    // Merkle proof
    signal input path_elements[tree_depth];
    signal input path_indices[tree_depth];  // 0 = left, 1 = right

    // Constraint 1: note value must cover amount + fee
    note_value === amount + fee;

    // Constraint 2: note_value must fit in u128 (matches runtime Balance type)
    component value_range_check = Num2Bits(128);
    value_range_check.in <== note_value;

    // Constraint 3: fee must fit in u128 (defense-in-depth; circuit is self-contained)
    component fee_range_check = Num2Bits(128);
    fee_range_check.in <== fee;

    // Constraint 4: compute note commitment
    component commitment_computer = NoteCommitment();
    commitment_computer.value <== note_value;
    commitment_computer.asset_id <== note_asset_id;
    commitment_computer.owner_pubkey <== note_owner;
    commitment_computer.blinding <== note_blinding;

    signal computed_commitment;
    computed_commitment <== commitment_computer.commitment;

    // Constraint 5: commitment must exist in the Merkle tree
    component merkle_verifier = MerkleTreeVerifier(tree_depth);
    merkle_verifier.leaf <== computed_commitment;

    for (var i = 0; i < tree_depth; i++) {
        merkle_verifier.path_elements[i] <== path_elements[i];
        merkle_verifier.path_index[i] <== path_indices[i];
    }

    merkle_verifier.root === merkle_root;

    // Constraint 6: nullifier must equal Poseidon(commitment, spending_key)
    component nullifier_computer = Nullifier();
    nullifier_computer.commitment <== computed_commitment;
    nullifier_computer.spending_key <== spending_key;

    nullifier_computer.nullifier === nullifier;

    // Constraint 7: note asset_id must match the declared public asset_id
    note_asset_id === asset_id;
}

// Tree depth 20 matches pallet MAX_TREE_DEPTH
component main {public [merkle_root, nullifier, amount, recipient, asset_id, fee]} = Unshield(20);
