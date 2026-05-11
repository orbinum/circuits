pragma circom 2.0.0;

include "./note.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/escalarmulfix.circom";
include "../node_modules/circomlib/circuits/escalarmulany.circom";

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

// Proves knowledge of a note preimage that opens the given commitment and
// selectively reveals chosen fields, encrypted with the auditor's Baby Jubjub
// public key using ECDH + Poseidon stream cipher.
//
// Encryption scheme (all arithmetic in BN254 scalar field):
//   r          <- private ephemeral scalar (random per disclosure)
//   epk        = r · G        (Baby Jubjub base point, public output)
//   shared     = r · pk_A     (ECDH shared secret, private witness)
//   k_i        = Poseidon(shared.x, shared.y, i)   (keystream PRF)
//   enc_f      = revealed_f + k_i   (one-time pad in the field)
//
// Decryption (off-chain, only auditor with sk_A where pk_A = sk_A · G):
//   shared     = sk_A · epk   (same shared secret by ECDH symmetry)
//   revealed_f = enc_f - k_i  (mod BN254 prime)
//
// Public signals (8 field elements = 256 bytes on-chain):
//   commitment, auditor_pk_x, auditor_pk_y,
//   epk_x, epk_y, enc_value, enc_asset_id, enc_owner_hash
template SelectiveDisclosure() {
    // ── Public inputs ─────────────────────────────────────────────────────
    signal input commitment;
    signal input auditor_pk_x;   // Baby Jubjub X-coord of auditor public key
    signal input auditor_pk_y;   // Baby Jubjub Y-coord of auditor public key

    // ── Public outputs (ciphertext — runtime verifies, only auditor decrypts)
    signal output epk_x;          // r·G ephemeral public key X
    signal output epk_y;          // r·G ephemeral public key Y
    signal output enc_value;      // revealed_value + k0  (field element)
    signal output enc_asset_id;   // revealed_asset_id + k1
    signal output enc_owner_hash; // Poseidon(owner_pubkey) + k2  (or k2 if hidden)

    // ── Private inputs ────────────────────────────────────────────────────
    signal input value;
    signal input asset_id;
    signal input owner_pubkey;
    signal input blinding;
    signal input disclose_value;      // 1 = reveal, 0 = hide
    signal input disclose_asset_id;
    signal input disclose_owner;
    signal input r;                   // ephemeral scalar (random, kept secret)

    // Constraint 1: commitment == Poseidon(value, asset_id, owner_pubkey, blinding)
    component note_commitment = NoteCommitment();
    note_commitment.value       <== value;
    note_commitment.asset_id    <== asset_id;
    note_commitment.owner_pubkey <== owner_pubkey;
    note_commitment.blinding    <== blinding;
    note_commitment.commitment  === commitment;

    // Constraint 2: disclosure masks must be boolean
    disclose_value    * (disclose_value    - 1) === 0;
    disclose_asset_id * (disclose_asset_id - 1) === 0;
    disclose_owner    * (disclose_owner    - 1) === 0;

    // Constraint 3: plaintext value (0 if hidden)
    component value_selector = Selector();
    value_selector.condition   <== disclose_value;
    value_selector.true_value  <== value;
    value_selector.false_value <== 0;

    // Constraint 4: plaintext asset_id (0 if hidden)
    component asset_selector = Selector();
    asset_selector.condition   <== disclose_asset_id;
    asset_selector.true_value  <== asset_id;
    asset_selector.false_value <== 0;

    // Constraint 5: owner hash = Poseidon(owner_pubkey), or 0 if hidden
    // Raw pubkey is never revealed — only its hash.
    component owner_hasher = Poseidon(1);
    owner_hasher.inputs[0] <== owner_pubkey;

    component owner_selector = Selector();
    owner_selector.condition   <== disclose_owner;
    owner_selector.true_value  <== owner_hasher.out;
    owner_selector.false_value <== 0;

    // Constraint 6: ephemeral public key  epk = r · G  (fixed base)
    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];
    component r_bits = Num2Bits(253);
    r_bits.in <== r;

    component epk_mul = EscalarMulFix(253, BASE8);
    for (var i = 0; i < 253; i++) {
        epk_mul.e[i] <== r_bits.out[i];
    }
    epk_x <== epk_mul.out[0];
    epk_y <== epk_mul.out[1];

    // Constraint 7: shared secret  shared = r · pk_A  (variable base)
    component shared_mul = EscalarMulAny(253);
    for (var i = 0; i < 253; i++) {
        shared_mul.e[i] <== r_bits.out[i];
    }
    shared_mul.p[0] <== auditor_pk_x;
    shared_mul.p[1] <== auditor_pk_y;

    // Constraint 8: Poseidon keystream from shared secret
    component k0 = Poseidon(3);
    k0.inputs[0] <== shared_mul.out[0];
    k0.inputs[1] <== shared_mul.out[1];
    k0.inputs[2] <== 0;

    component k1 = Poseidon(3);
    k1.inputs[0] <== shared_mul.out[0];
    k1.inputs[1] <== shared_mul.out[1];
    k1.inputs[2] <== 1;

    component k2 = Poseidon(3);
    k2.inputs[0] <== shared_mul.out[0];
    k2.inputs[1] <== shared_mul.out[1];
    k2.inputs[2] <== 2;

    // Constraint 9: ciphertext = plaintext + keystream (field addition, no overflow)
    enc_value      <== value_selector.out  + k0.out;
    enc_asset_id   <== asset_selector.out  + k1.out;
    enc_owner_hash <== owner_selector.out  + k2.out;
}

component main {public [commitment, auditor_pk_x, auditor_pk_y]} = SelectiveDisclosure();
