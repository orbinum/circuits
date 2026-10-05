pragma circom 2.0.0;

include "./note.circom";

// Shield: proves a deposit's commitment encodes exactly the deposited value and
// asset. The pallet supplies `value` and `asset_id` from the call, so a note
// worth more than what entered the pool cannot be inserted.
// Owner and blinding stay private and unconstrained: a commitment to a key the
// depositor does not hold only locks the depositor's own funds.
template Shield() {
    // ── Public inputs ─────────────────────────────────────────────────────────
    signal input commitment;    // the leaf being inserted
    signal input value;         // deposited amount (u128, set by the pallet)
    signal input asset_id;      // deposited asset (u32, set by the pallet)

    // ── Private inputs ────────────────────────────────────────────────────────
    signal input owner_pubkey;  // BabyJubJub Ax of the note owner
    signal input blinding;

    component note = NoteCommitment();
    note.value <== value;
    note.asset_id <== asset_id;
    note.owner_pubkey <== owner_pubkey;
    note.blinding <== blinding;
    note.commitment === commitment;
}

component main {public [commitment, value, asset_id]} = Shield();
