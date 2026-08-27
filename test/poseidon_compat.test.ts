/**
 * Poseidon test vectors, pinned.
 *
 * The chain verifies proofs about commitments and nullifiers that this
 * package's circuits compute, and the runtime recomputes those same hashes in
 * Rust (`orbinum-zk-core`). If the two implementations ever disagree — a
 * different arity, a different round constant, a different field encoding — a
 * proof that verifies here is rejected there, with nothing in the output to say
 * why.
 *
 * This file used to print the vectors to stdout and assert only that they were
 * non-zero, leaving the actual comparison to a human reading the log. A
 * Poseidon that returned `1` for everything would have passed. The values below
 * are the same ones it printed, now asserted — so a change in circomlibjs, or a
 * mistaken bump of it, fails here rather than downstream.
 *
 * These are also the vectors to check the Rust side against. They are stated in
 * decimal because that is the form snarkjs and circomlibjs use on the wire.
 */
import { expect } from "chai";

import { NoteCrypto } from "../scripts/lib/note";

/** Poseidon(1, 2) — the canonical two-input vector. */
const HASH_2 = 7853200120776062878684798364095072458815029376092732009249414926327459813530n;

/** Poseidon(1, 2, 3, 4) — the four-input arity a note commitment uses. */
const HASH_4 = 18821383157269793795438455681495246036402687001665670618754263018637548127333n;

/** The note this vector describes, matching `circuits/note.circom`'s ordering. */
const NOTE = {
    value: 1000n,
    assetId: 0n,
    ownerPubkey: 0x0102030405060708091011121314151617181920212223242526272829303132n,
    blinding: 0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899n,
};

/** Poseidon(value, asset_id, owner_pubkey, blinding) for the note above. */
const COMMITMENT = 9726555693554475601316991615770103404569284734079260402052673641165735928858n;

const SPENDING_KEY = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn;

/** Poseidon(commitment, spending_key) for the note and key above. */
const NULLIFIER = 18776340054730240697388182256131431183119681580840996569730682348730394387121n;

describe("Poseidon cross-implementation vectors", function () {
    this.timeout(30_000);

    let note: NoteCrypto;

    before(async function () {
        note = await NoteCrypto.build();
    });

    it("Poseidon(1, 2) matches the pinned vector", function () {
        expect(note.hash([1n, 2n])).to.equal(HASH_2);
    });

    it("Poseidon(1, 2, 3, 4) matches the pinned vector", function () {
        expect(note.hash([1n, 2n, 3n, 4n])).to.equal(HASH_4);
    });

    it("a note commitment matches the pinned vector", function () {
        expect(note.commitment(NOTE.value, NOTE.assetId, NOTE.ownerPubkey, NOTE.blinding)).to.equal(
            COMMITMENT
        );
    });

    it("a nullifier matches the pinned vector", function () {
        expect(note.nullifier(COMMITMENT, SPENDING_KEY)).to.equal(NULLIFIER);
    });

    describe("properties the circuits depend on", () => {
        // Not vector checks, but the assumptions a wrong implementation would
        // break without changing any single vector.
        it("arity matters: Poseidon(1,2) is not Poseidon(1,2,3,4)", function () {
            expect(note.hash([1n, 2n])).to.not.equal(note.hash([1n, 2n, 3n, 4n]));
        });

        it("order matters: Poseidon(1,2) is not Poseidon(2,1)", function () {
            expect(note.hash([1n, 2n])).to.not.equal(note.hash([2n, 1n]));
        });

        it("a different blinding gives a different commitment", function () {
            const other = note.commitment(
                NOTE.value,
                NOTE.assetId,
                NOTE.ownerPubkey,
                NOTE.blinding + 1n
            );
            expect(other).to.not.equal(COMMITMENT);
        });

        it("a different spending key gives a different nullifier", function () {
            expect(note.nullifier(COMMITMENT, SPENDING_KEY + 1n)).to.not.equal(NULLIFIER);
        });
    });
});
