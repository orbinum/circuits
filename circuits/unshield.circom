pragma circom 2.0.0;

include "./note.circom";
include "./merkle_tree.circom";
include "./poseidon_wrapper.circom";
include "../node_modules/circomlib/circuits/babyjub.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Unshield: withdraws a private note to a public account.
// Supports partial withdrawal via a change note:
//   note_value === amount + fee + change_value
// When change_value == 0 (total withdrawal), change_commitment must be 0
// and the pallet skips inserting it into the Merkle tree.
// When change_value > 0 (partial withdrawal), change_commitment must equal
// NoteCommitment(change_value, asset_id, change_owner_pubkey, change_blinding)
// and the pallet inserts it into the Merkle tree.
// Ownership is proven via BabyPbk(spending_key) → ownerPk (Constraint 0).
template Unshield(tree_depth) {
    // ── Public inputs ─────────────────────────────────────────────────────────
    signal input merkle_root;
    signal input nullifier;
    signal input amount;             // net withdrawal amount (recipient receives this)
    signal input recipient;          // recipient address (validated non-zero in runtime)
    signal input asset_id;           // asset being unshielded
    signal input fee;                // gasless fee deducted from note value
    signal input change_commitment;  // 0 if total unshield; NoteCommitment of change otherwise

    // ── Private inputs — input note ───────────────────────────────────────────
    signal input note_value;
    signal input note_asset_id;
    signal input note_blinding;
    signal input spending_key;

    // ── Private inputs — change note ──────────────────────────────────────────
    signal input change_value;        // 0 for total unshield; change amount for partial
    signal input change_blinding;     // blinding for the change note (ignored when change_value == 0)
    signal input change_owner_pubkey; // BabyJubJub Ax of change note owner (ignored when change_value == 0)

    // ── Merkle proof ──────────────────────────────────────────────────────────
    signal input path_elements[tree_depth];
    signal input path_indices[tree_depth];  // 0 = left, 1 = right

    // ── Constraint 1: conservation of value ───────────────────────────────────
    // note_value must equal amount withdrawn + relay fee + change returned to pool.
    // When change_value == 0 this reduces to the original: note_value === amount + fee.
    note_value === amount + fee + change_value;

    // ── Constraint 2: note_value must fit in u128 ─────────────────────────────
    component value_range_check = Num2Bits(128);
    value_range_check.in <== note_value;

    // ── Constraint 3: fee must fit in u128 ────────────────────────────────────
    component fee_range_check = Num2Bits(128);
    fee_range_check.in <== fee;

    // ── Constraint 0: derive owner pubkey from spending_key (BabyPbk) ─────────
    // Proves the prover knows the discrete log of the ownerPk in the commitment.
    // Defined early because the derived Ax is needed in Constraint 4.
    component key_derivation = BabyPbk();
    key_derivation.in <== spending_key;

    // ── Constraint 4: compute input note commitment ────────────────────────────
    component commitment_computer = NoteCommitment();
    commitment_computer.value <== note_value;
    commitment_computer.asset_id <== note_asset_id;
    commitment_computer.owner_pubkey <== key_derivation.Ax;
    commitment_computer.blinding <== note_blinding;

    signal computed_commitment;
    computed_commitment <== commitment_computer.commitment;

    // ── Constraint 5: input commitment must exist in the Merkle tree ──────────
    component merkle_verifier = MerkleTreeVerifier(tree_depth);
    merkle_verifier.leaf <== computed_commitment;

    for (var i = 0; i < tree_depth; i++) {
        merkle_verifier.path_elements[i] <== path_elements[i];
        merkle_verifier.path_index[i] <== path_indices[i];
    }

    merkle_verifier.root === merkle_root;

    // ── Constraint 6: nullifier == Poseidon(commitment, spending_key) ──────────
    component nullifier_computer = Nullifier();
    nullifier_computer.commitment <== computed_commitment;
    nullifier_computer.spending_key <== spending_key;

    nullifier_computer.nullifier === nullifier;

    // ── Constraint 7: note asset_id must match the public asset_id ─────────────
    note_asset_id === asset_id;

    // ── Constraint 9: change_value must fit in u128 ───────────────────────────
    component change_range_check = Num2Bits(128);
    change_range_check.in <== change_value;

    // ── Constraint 8: change note commitment ──────────────────────────────────
    // Determine whether change_value is zero.
    // has_no_change.out == 1  →  change_value == 0  (total unshield)
    // has_no_change.out == 0  →  change_value > 0   (partial unshield)
    component has_no_change = IsZero();
    has_no_change.in <== change_value;

    // Compute the expected change commitment regardless of has_no_change —
    // R1CS constraints are always evaluated. The binding is enforced below.
    component change_commitment_computer = NoteCommitment();
    change_commitment_computer.value <== change_value;
    change_commitment_computer.asset_id <== note_asset_id;  // same asset
    change_commitment_computer.owner_pubkey <== change_owner_pubkey;
    change_commitment_computer.blinding <== change_blinding;

    // 8a: if change_value > 0, the public change_commitment must match.
    signal change_commitment_diff;
    change_commitment_diff <== change_commitment_computer.commitment - change_commitment;
    change_commitment_diff * (1 - has_no_change.out) === 0;

    // 8b: if change_value == 0, the public change_commitment must be 0.
    change_commitment * has_no_change.out === 0;
}

// Tree depth 20 matches pallet MAX_TREE_DEPTH
component main {public [merkle_root, nullifier, amount, recipient, asset_id, fee, change_commitment]} = Unshield(20);
