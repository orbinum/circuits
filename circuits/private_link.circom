pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Proves knowledge of the preimage of a commitment stored in pallet-account-mapping,
// without revealing the external wallet address.
//
// Commitment scheme (mirrors Rust in `reveal_private_link`):
//   inner      = Poseidon(chain_id_fe, address_fe)
//   commitment = Poseidon(inner, blinding_fe)
//
// Field encoding (must match Fr::from_le_bytes_mod_order in Rust):
//   chain_id_fe : BigInt(chain_id)  — fits in u32, always < p
//   address_fe  : address bytes zero-padded right to 32 bytes, LE integer mod p
//   blinding_fe : 32-byte random scalar, LE integer mod p, must be < p
//
// Public inputs : commitment, call_hash_fe
// Private inputs: chain_id_fe, address_fe, blinding_fe
template PrivateLinkDispatch() {
    // Public signals
    signal input commitment;     // stored on-chain in PrivateChainLinks
    signal input call_hash_fe;   // blake2_256(SCALE-encoded call) as LE BN254 field element

    // Private witness signals
    signal input chain_id_fe;
    signal input address_fe;
    signal input blinding_fe;

    // Constraint 1: commitment == Poseidon(Poseidon(chain_id_fe, address_fe), blinding_fe)
    component h1 = Poseidon(2);
    h1.inputs[0] <== chain_id_fe;
    h1.inputs[1] <== address_fe;

    component h2 = Poseidon(2);
    h2.inputs[0] <== h1.out;
    h2.inputs[1] <== blinding_fe;

    commitment === h2.out;

    // Constraint 2: bind proof to call_hash_fe
    // Must be quadratic — linear constraints are eliminated by --O1 simplification,
    // which would give call_hash_fe a zero coefficient in gamma_abc, making the
    // proof replayable across different calls.
    signal call_hash_sq;
    call_hash_sq <== call_hash_fe * call_hash_fe;
}

component main { public [commitment, call_hash_fe] } = PrivateLinkDispatch();
