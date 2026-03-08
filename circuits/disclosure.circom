pragma circom 2.0.0;

include "./note.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

// Returns true_value if condition=1, false_value if condition=0.
// Enforces condition is boolean.
template Selector() {
    signal input condition;
    signal input true_value;
    signal input false_value;
    signal output out;

    condition * (condition - 1) === 0;

    signal inv_condition;
    inv_condition <== 1 - condition;

    signal term1;
    signal term2;
    term1 <== condition * true_value;
    term2 <== inv_condition * false_value;

    out <== term1 + term2;
}

// Proves knowledge of a note preimage that opens the given commitment,
// and selectively reveals chosen fields according to disclosure masks.
template SelectiveDisclosure() {
    // Public inputs
    signal input commitment;
    signal input revealed_value;       // actual value if disclose_value=1, else 0
    signal input revealed_asset_id;    // actual asset_id if disclose_asset_id=1, else 0
    signal input revealed_owner_hash;  // Poseidon(owner_pubkey) if disclose_owner=1, else 0

    // Private inputs
    signal input value;
    signal input asset_id;
    signal input owner_pubkey;
    signal input blinding;
    signal input disclose_value;      // 1 = reveal, 0 = hide
    signal input disclose_asset_id;
    signal input disclose_owner;

    // Constraint 1: commitment must match Poseidon(value, asset_id, owner_pubkey, blinding)
    component note_commitment = NoteCommitment();
    note_commitment.value <== value;
    note_commitment.asset_id <== asset_id;
    note_commitment.owner_pubkey <== owner_pubkey;
    note_commitment.blinding <== blinding;

    note_commitment.commitment === commitment;

    // Constraint 2: disclosure masks must be boolean
    disclose_value * (disclose_value - 1) === 0;
    disclose_asset_id * (disclose_asset_id - 1) === 0;
    disclose_owner * (disclose_owner - 1) === 0;

    // Constraint 3: revealed_value == value if disclose_value=1, else 0
    component value_selector = Selector();
    value_selector.condition <== disclose_value;
    value_selector.true_value <== value;
    value_selector.false_value <== 0;

    revealed_value === value_selector.out;

    // Constraint 4: revealed_asset_id == asset_id if disclose_asset_id=1, else 0
    component asset_selector = Selector();
    asset_selector.condition <== disclose_asset_id;
    asset_selector.true_value <== asset_id;
    asset_selector.false_value <== 0;

    revealed_asset_id === asset_selector.out;

    // Constraint 5: revealed_owner_hash == Poseidon(owner_pubkey) if disclose_owner=1, else 0
    // Owner hash is revealed instead of the raw pubkey to preserve additional privacy.
    component owner_hasher = Poseidon(1);
    owner_hasher.inputs[0] <== owner_pubkey;

    component owner_selector = Selector();
    owner_selector.condition <== disclose_owner;
    owner_selector.true_value <== owner_hasher.out;
    owner_selector.false_value <== 0;

    revealed_owner_hash === owner_selector.out;
}

component main {public [commitment, revealed_value, revealed_asset_id, revealed_owner_hash]} = SelectiveDisclosure();
