pragma circom 2.0.0;

include "./note.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

// Proves knowledge of a note preimage that opens the given commitment.
//
// Used by pallet-shielded-pool::claim_shielded_fees to guarantee that
// the commitment inserted into the Merkle tree encodes exactly the declared
// (value, asset_id) before any relay-fee accounting occurs.
//
// Without this proof a relayer could craft a commitment encoding a larger
// value (e.g. 10× the pending fees) and later unshield that inflated amount.
//
// Public signals layout (76 bytes on-chain):
//   commitment[0..32]   — field element, 32-byte LE
//   value[32..40]       — u64 LE (fits in BN254 scalar field)
//   asset_id[40..44]    — u32 LE
//   owner_hash[44..76]  — Poseidon(owner_pubkey), 32-byte LE
//
// The on-chain verifier checks:
//   1. public_signals[0..32]  == commitment  (arg match)
//   2. public_signals[32..40] == amount      (value match, u64 LE)
//   3. public_signals[40..44] == asset_id    (asset match, u32 LE)
//   owner_hash is provided for off-chain audit but not enforced on-chain.
//
// Decryption / audit: owner_pubkey remains private; only its Poseidon hash
// is revealed, preventing linkage to the Baby Jubjub public key.
template ValueProof() {
    // ── Public inputs ─────────────────────────────────────────────────────
    signal input commitment;
    signal input value;      // u64 — must fit in BN254 scalar field
    signal input asset_id;   // u32

    // ── Public outputs ────────────────────────────────────────────────────
    signal output owner_hash; // Poseidon(owner_pubkey) — auxiliary, not enforced

    // ── Private inputs ────────────────────────────────────────────────────
    signal input owner_pubkey;
    signal input blinding;

    // Constraint 1: commitment == Poseidon(value, asset_id, owner_pubkey, blinding)
    component note_commitment = NoteCommitment();
    note_commitment.value        <== value;
    note_commitment.asset_id     <== asset_id;
    note_commitment.owner_pubkey <== owner_pubkey;
    note_commitment.blinding     <== blinding;
    note_commitment.commitment   === commitment;

    // Constraint 2: owner_hash = Poseidon(owner_pubkey) — keeps pubkey private
    component hasher = Poseidon(1);
    hasher.inputs[0] <== owner_pubkey;
    owner_hash <== hasher.out;
}

component main {public [commitment, value, asset_id]} = ValueProof();
