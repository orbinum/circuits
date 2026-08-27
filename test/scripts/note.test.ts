/**
 * `NoteCrypto` — the JavaScript mirror of the circom note templates.
 *
 * Every circuit suite uses this to compute what the circuit is about to compute
 * and assert the two agree, and `make-fixture.ts` uses it to build the golden
 * fixtures this package publishes. Four consumers, and none of them tests it:
 * they use it as a fixture builder, so a bug here would make a test's
 * *expectation* wrong in exactly the way that keeps the assertion passing.
 *
 * `merkleProof` is the piece that most needs its own test. It builds a sparse
 * tree — materialising only the non-zero nodes, because a dense tree at depth
 * 20 would be a million nodes for the one or two leaves a test uses — and that
 * optimisation is the kind that is right for the cases you tried and wrong for
 * the one you did not.
 */
import { expect } from "chai";

import { NoteCrypto, TREE_DEPTH } from "../../scripts/lib/note";

describe("scripts/lib/note", function () {
    this.timeout(60_000);

    let note: NoteCrypto;

    before(async function () {
        note = await NoteCrypto.build();
    });

    describe("merkleProof", () => {
        /**
         * The same root, computed densely.
         *
         * Fills every position at every level rather than skipping the empty
         * ones, which is what the sparse version is an optimisation of. If the
         * two disagree, the optimisation is wrong.
         */
        function denseRoot(leaves: bigint[], depth: number): bigint {
            let level = [...leaves];
            for (let d = 0; d < depth; d++) {
                const width = 1 << Math.max(0, depth - d - 1);
                const next: bigint[] = [];
                for (
                    let i = 0;
                    i < Math.max(1, Math.min(width, Math.ceil(level.length / 2)));
                    i++
                ) {
                    next.push(note.hash([level[2 * i] ?? 0n, level[2 * i + 1] ?? 0n]));
                }
                level = next;
            }
            return level[0] ?? 0n;
        }

        it("a single leaf gives the same root as a dense computation", function () {
            const leaf = note.commitment(100n, 0n, 7n, 42n);
            const depth = 4;

            const sparse = note.merkleProof([leaf], 0, depth);
            expect(sparse.root).to.equal(denseRoot([leaf], depth));
        });

        it("two leaves agree with a dense computation, at either index", function () {
            const leaves = [note.commitment(1n, 0n, 7n, 1n), note.commitment(2n, 0n, 7n, 2n)];
            const depth = 4;
            const expected = denseRoot(leaves, depth);

            expect(note.merkleProof(leaves, 0, depth).root).to.equal(expected);
            expect(note.merkleProof(leaves, 1, depth).root).to.equal(expected);
        });

        it("the path has one entry per level", function () {
            const proof = note.merkleProof([1n], 0, TREE_DEPTH);
            expect(proof.pathElements).to.have.length(TREE_DEPTH);
            expect(proof.pathIndices).to.have.length(TREE_DEPTH);
        });

        it("path indices are the leaf index in binary, least significant first", function () {
            // Index 5 is 0b101, so the path turns right, left, right going up.
            const leaves = Array.from({ length: 8 }, (_, i) => BigInt(i + 1));
            const proof = note.merkleProof(leaves, 5, 4);
            expect(proof.pathIndices.slice(0, 3)).to.deep.equal([1, 0, 1]);
        });

        it("a sibling that does not exist is the empty value", function () {
            // One leaf at index 0: every sibling on the way up is absent, so
            // every path element is zero. Getting this wrong is how a sparse
            // tree silently computes a different root than a dense one.
            const proof = note.merkleProof([99n], 0, 4);
            expect(proof.pathElements).to.deep.equal([0n, 0n, 0n, 0n]);
        });

        it("different leaves give different roots", function () {
            const a = note.merkleProof([1n], 0, 4).root;
            const b = note.merkleProof([2n], 0, 4).root;
            expect(a).to.not.equal(b);
        });

        it("the same leaf at a different index gives a different root", function () {
            const leaf = note.commitment(5n, 0n, 7n, 9n);
            expect(note.merkleProof([leaf], 0, 4).root).to.not.equal(
                note.merkleProof([0n, leaf], 1, 4).root
            );
        });

        it("singleLeafTree matches merkleProof with one leaf", function () {
            const leaf = note.commitment(3n, 0n, 7n, 4n);
            expect(note.singleLeafTree(leaf, 0, 4)).to.deep.equal(note.merkleProof([leaf], 0, 4));
        });
    });

    describe("note primitives", () => {
        it("a commitment binds every one of its four fields", function () {
            const base = note.commitment(100n, 0n, 7n, 42n);
            expect(note.commitment(101n, 0n, 7n, 42n)).to.not.equal(base);
            expect(note.commitment(100n, 1n, 7n, 42n)).to.not.equal(base);
            expect(note.commitment(100n, 0n, 8n, 42n)).to.not.equal(base);
            expect(note.commitment(100n, 0n, 7n, 43n)).to.not.equal(base);
        });

        it("a nullifier binds the commitment and the spending key", function () {
            const c = note.commitment(100n, 0n, 7n, 42n);
            const base = note.nullifier(c, 5n);
            expect(note.nullifier(c + 1n, 5n)).to.not.equal(base);
            expect(note.nullifier(c, 6n)).to.not.equal(base);
        });

        it("ownerPubkey is deterministic and key-dependent", function () {
            expect(note.ownerPubkey(5n)).to.equal(note.ownerPubkey(5n));
            expect(note.ownerPubkey(5n)).to.not.equal(note.ownerPubkey(6n));
        });

        it("ownerHash hides the key it was derived from", function () {
            const pk = note.ownerPubkey(5n);
            const hash = note.ownerHash(pk);
            expect(hash).to.not.equal(pk);
            expect(note.ownerHash(pk)).to.equal(hash);
        });
    });
});
