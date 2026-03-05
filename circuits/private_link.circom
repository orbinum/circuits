pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

/*
 * PrivateLinkDispatch
 * ===================
 * Proves knowledge of the preimage of a Poseidon commitment stored on-chain
 * in `pallet-account-mapping`, enabling `dispatch_as_private_link` without
 * revealing the external wallet address.
 *
 * COMMITMENT SCHEME
 * -----------------
 * Mirrors the on-chain computation in Rust (`reveal_private_link` /
 * `dispatch_as_private_link`):
 *
 *   inner      = Poseidon2( chain_id_fe,  address_fe  )
 *   commitment = Poseidon2( inner,        blinding_fe )
 *
 * Field-element encoding — must match `Fr::from_le_bytes_mod_order` in Rust:
 *
 *   chain_id_fe : Fr::from(chain_id as u64)
 *                 → 4-byte little-endian, zero-padded to 32 bytes
 *                 → equivalent to BigInt(chain_id) since chain_id ≤ 2^32
 *
 *   address_fe  : address bytes (≤ 32 bytes), zero-padded on the RIGHT to
 *                 exactly 32 bytes, then interpreted as a little-endian integer
 *                 modulo the BN254 scalar field order p.
 *
 *   blinding_fe : 32-byte uniformly random scalar, interpreted as a LE integer
 *                 modulo p.  Must satisfy: blinding < p.
 *
 * REPLAY PROTECTION
 * -----------------
 * `call_hash_fe` is a public signal equal to blake2_256(SCALE-encoded call)
 * interpreted as a LE BN254 field element.  Groth16 binds every proof to its
 * full public-input vector: any modification to call_hash_fe invalidates the
 * pairing check, preventing proof reuse across different calls.
 *
 * SIGNALS
 * -------
 *  Public  : commitment, call_hash_fe
 *  Private : chain_id_fe, address_fe, blinding_fe
 *
 * CONSTRAINTS
 * -----------
 * ~500 R1CS constraints (two Poseidon(2) calls at ~238 constraints each).
 * Requires ptau power ≥ 10 (covers up to 1 024 constraints).
 *
 * See: frame/account-mapping/src/lib.rs — `reveal_private_link`, `dispatch_as_private_link`
 */
template PrivateLinkDispatch() {
    // ── Public signals ────────────────────────────────────────────────────
    /// Stored on-chain in the `PrivateChainLinks` storage map.
    /// Equals Poseidon2(Poseidon2(chain_id_fe, address_fe), blinding_fe).
    signal input commitment;

    /// blake2_256(SCALE-encoded call) as a LE BN254 field element.
    /// Groth16 public-input binding prevents proof replay across different calls.
    signal input call_hash_fe;

    // ── Private witness signals ───────────────────────────────────────────
    /// BigInt(chain_id): the chain identifier as a BN254 scalar (≤ 2^32 < p).
    signal input chain_id_fe;

    /// address bytes (≤ 32 B) zero-padded right to 32 bytes, LE integer mod p.
    signal input address_fe;

    /// 32-byte uniformly random blinding scalar, LE integer mod p.
    signal input blinding_fe;

    // ── Constraint 1: Commitment correctness ─────────────────────────────

    // First hash: bind chain identity.
    component h1 = Poseidon(2);
    h1.inputs[0] <== chain_id_fe;
    h1.inputs[1] <== address_fe;

    // Second hash: fold in blinding to produce the commitment.
    component h2 = Poseidon(2);
    h2.inputs[0] <== h1.out;
    h2.inputs[1] <== blinding_fe;

    commitment === h2.out;

    // ── Constraint 2: Bind proof to call_hash_fe ─────────────────────────
    // CRITICAL: must use a QUADRATIC constraint — linear constraints (`b <== a`)
    // are eliminated by circom's --O1 linear simplification, which removes the
    // signal from the R1CS and causes call_hash_fe to have a zero coefficient
    // in the Groth16 gamma_abc (verification key), making the proof replayable
    // across different calls.
    //
    // A quadratic constraint is never eliminated by --O1 (only --O2 targets
    // non-linear simplification, which is not used here).
    signal call_hash_sq;
    call_hash_sq <== call_hash_fe * call_hash_fe;
}

component main { public [commitment, call_hash_fe] } = PrivateLinkDispatch();
