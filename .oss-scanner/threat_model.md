# Threat model

## What this project does

Orbinum Circuits are the Circom 2 / Groth16 (BN254) circuits behind the Orbinum shielded
pool. The chain (`orbinum/node`, `pallet-shielded-pool` + `pallet-zk-verifier`) verifies
these proofs and trusts whatever statement they encode: a satisfied circuit is the only
authority for spending a note. An under-constrained circuit is therefore a consensus-level
bug even if every line of the pallet is correct.

Note scheme: UTXO notes `NoteCommitment(value, asset_id, owner_pubkey, blinding)` using
Poseidon (circomlib), ownership via `BabyPbk(spending_key)` on BabyJubJub, Merkle tree
depth 20, values range-checked as u128 (Substrate `Balance`).

Application circuits (`circuits/`):

- `transfer.circom` — 2-in / 2-out private transfer with dummy-input support (an input
  with `value = 0` skips Merkle membership; its nullifier is forced to 0). Public:
  `merkle_roots[2], nullifiers[2], commitments[2], asset_id, fee, memo_hash`.
- `unshield.circom` — withdraw a note to a public account with optional change note
  (`note_value == amount + fee + change_value`; `change_commitment == 0` iff
  `change_value == 0`). Public: `merkle_root, nullifier, amount, recipient, asset_id, fee,
change_commitment, memo_hash`.
- `shield.circom` — binds a deposit commitment to the pallet-supplied `value` and
  `asset_id`. Public: `commitment, value, asset_id`.

Shared components: `note.circom`, `spend.circom`, `merkle_tree.circom`,
`poseidon_wrapper.circom`.

## Where untrusted input enters

- **Private witness**: the prover is the attacker. Every private signal (values, blindings,
  spending keys, Merkle paths and indices, output notes) is fully attacker-chosen, and the
  attacker can use a custom witness generator, not just the compiled wasm. Only the
  R1CS constraints matter; `<--` assignments and wasm-side checks give no protection.
- **Public inputs**: chosen by the submitter. The pallet builds them from the extrinsic
  (roots, nullifiers, commitments, `amount`, `recipient`, `fee`, `memo_hash`) and, for
  shield, takes `value` / `asset_id` from the deposit call itself.
- **Proof relaying**: a third party (relayer, mempool observer) can see a valid proof and
  its public inputs and try to resubmit them with different call parameters.

Trusted: the published powers-of-tau and ceremony outputs (zkey, verifying key), the
circom compiler, circomlib.

## Checks the circuits leave to the pallet

The pallet lives in another repository (`orbinum/node`) and is not in this image. The
circuits rely on it for the following; a circuit is not vulnerable merely because one of
these is absent from the constraints. A report may still argue that one of them belongs
in the circuit, but must say which pallet behaviour it assumes.

- Each `merkle_root` is a current or recent historic root of a known tree; for a dummy
  transfer input (value 0) the root is unconstrained by the circuit and pinned by the
  pallet.
- Each non-zero nullifier has not been seen before; a transfer with both nullifiers zero
  is rejected.
- `recipient` is non-zero and equals `blake2_256(AccountId32) mod r` of the payout
  account; `fee` is paid to the committed relayer or block author.
- `asset_id` is a `u32` (no range check in-circuit); shield `value` is the `u128`
  deposit amount (no range check in-circuit).
- The Groth16 verifier rejects public inputs that are not canonical field elements
  (`>= r`).

Intentional, not vulnerabilities:

- `shield.circom` leaves `owner_pubkey` and `blinding` unconstrained: a depositor who
  commits to a key they do not hold only locks their own funds.
- Transfer outputs may have value 0 and any `owner_pubkey`; output commitments are not
  checked for uniqueness in-circuit.
- `memo_hash * memo_hash` and `recipient * recipient` exist only to keep those public
  inputs in the R1CS; they are not meant to constrain the values.

## Components that matter most / least

Highest priority:

- Under-constrained signals in any application circuit or shared component: missing
  `===` after `<--`, missing booleanity on path indices / selectors, missing or wrong
  `Num2Bits(128)` range checks on values and fees, field overflow (sums that wrap mod
  r), `IsZero` / `LessThan` usage from circomlib.
- Value conservation and asset consistency: inputs vs outputs + fee in transfer,
  `note_value == amount + fee + change_value` in unshield, mixing assets across notes.
- Nullifier soundness: nullifier must be uniquely bound to the spent note and its
  owner's key, so one note yields exactly one nullifier; dummy-input path must not
  allow a real note to be spent without a nullifier or a nullifier to be forged.
- Merkle membership: `Selector` / `MerkleTreeVerifier` correctness, root binding per
  input, any way to prove membership of a leaf not in the tree.
- Public-input binding / malleability: `recipient`, `fee`, `memo_hash`,
  `change_commitment` must be constrained so a copied proof cannot be redirected.
- Ownership (`spend.circom`): spending a note without its `spending_key`. The owner key
  is only `BabyPbk(spending_key).Ax`, and `SpendingKeyOwner` forces the key below the
  Base8 subgroup order so `k` and `k + l` cannot give two nullifiers for one note;
  check that this canonicality argument holds end to end.
- Poseidon parameter / domain compatibility between `poseidon_wrapper.circom`,
  `test/helpers/circuit-inputs.ts` and circomlibjs (vectors in `test/poseidon_compat.test.ts`).

Medium priority:

- `scripts/lib/vk-hash.ts`, `scripts/utils/generate-manifest.ts`,
  `scripts/release/{restore,verify}-artifacts.ts`: anything that lets a release ship a
  verifying key or artifact whose sha256 / `vk_hash` does not match `manifest.json`.
- `npm/index.js` (the published package entry point consumed by wallets/SDKs).

Out of scope:

- Trusted-setup security itself (toxic waste, ceremony participants).
- Bugs in circom, snarkjs, circomlib or arkworks unless Orbinum's usage makes them
  exploitable.
- `docs/`, lint/format config, test helpers, developer-only scripts with no release impact.
- Prover-side performance or witness-generation crashes that only hurt the prover.

## How to exercise it

The image has circom (`v2.2.3`), compiled circuits in `build/`, ceremony keys in `keys/`,
and `PACK_VERIFYING_KEY_BIN` set.

- Full suite: `pnpm run test:strict` (mocha, `test/*.test.ts`).
- One suite: `pnpm exec mocha test/transfer.test.ts`.
- Component tests compile temporary circuits with `circom_tester`; write a small test
  harness circuit to probe a component in isolation.
- Fixtures: `fixtures/<circuit>.input.json`; witnesses via `pnpm run fixture <circuit>`.
- Prove/verify with snarkjs against `build/` wasm and `keys/` zkey to demonstrate a
  forged-but-verifying proof.

## How we rate severity

- **Critical**: a proof that verifies for a false statement: inflating value, spending a
  note twice (two distinct nullifiers for one note), spending a note not in the tree or
  not owned by the prover, asset substitution, shield deposit not bound to its value.
- **High**: proof malleability that redirects funds or fees (changing `recipient`, `fee`,
  `change_commitment` or `memo_hash` without a new proof); release tooling that can
  publish a verifying key not matching the manifest `vk_hash`; deanonymizing users from
  public inputs.
- **Medium**: soundness issues needing unrealistic preconditions; Poseidon/encoding
  mismatches that make honest proofs fail (denial of service for users).
- **Low**: missing checks with no demonstrated exploit, documentation/constraint-count
  drift.

## Reports and patches

Include a concrete witness (input JSON) or a mocha test showing the circuit accepts the
malicious assignment, ideally with a snarkjs proof that verifies against `keys/`. Patches
must keep public-input order and count unchanged where possible; note any change to
constraint counts, since it requires a new ceremony and on-chain verifying-key rotation.
