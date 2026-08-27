/**
 * The note cryptography the circuits implement, in JavaScript.
 *
 * This is a reference implementation, not test scaffolding. It mirrors the
 * circom templates in `circuits/note.circom` and `circuits/merkle_tree.circom`,
 * and it has two kinds of consumer: the circuit tests, which use it to compute
 * what the circuit is about to compute and assert the two agree, and
 * `scripts/utils/make-fixture.ts`, which uses it to build the golden fixtures
 * this package publishes.
 *
 * That second consumer is why it lives here rather than under `test/`. A build
 * script importing from the test tree inverts the dependency: `test/` may reach
 * into `scripts/`, never the other way round.
 *
 * The duplication it replaced was worth removing. `computeCommitment` existed
 * four times — once per circuit suite plus a `commit` inside `make-fixture.ts`
 * — and `buildMerkleProof` twice, byte-identical. If a circuit changes the
 * order of its Poseidon inputs, every copy has to change with it, and nothing
 * warns you about the one you missed. A proof built against a stale copy is
 * well-formed and fails verification with nothing to explain why.
 */
import { buildBabyjub, buildPoseidon } from "circomlibjs";

/** Matches the tree depth every circuit is instantiated with. */
export const TREE_DEPTH = 20;

/** A Merkle proof, in the shape the circuits take as private input. */
export interface MerkleProof {
    root: bigint;
    pathElements: bigint[];
    pathIndices: number[];
}

/**
 * The note primitives, bound to an initialised Poseidon and Baby JubJub.
 *
 * Built once per suite — `buildPoseidon()` is expensive — and shared by every
 * case in it.
 */
export class NoteCrypto {
    private constructor(
        private readonly poseidon: any,
        private readonly babyJub: any,
        readonly F: any
    ) {}

    static async build(): Promise<NoteCrypto> {
        const poseidon = await buildPoseidon();
        const babyJub = await buildBabyjub();
        return new NoteCrypto(poseidon, babyJub, poseidon.F);
    }

    /** Poseidon over field elements, as a bigint. */
    hash(inputs: bigint[]): bigint {
        return this.F.toObject(this.poseidon(inputs));
    }

    /** `NoteCommitment` — Poseidon(value, asset_id, owner_pubkey, blinding). */
    commitment(value: bigint, assetId: bigint, ownerPubkey: bigint, blinding: bigint): bigint {
        return this.hash([value, assetId, ownerPubkey, blinding]);
    }

    /** `Nullifier` — Poseidon(commitment, spending_key). */
    nullifier(commitment: bigint, spendingKey: bigint): bigint {
        return this.hash([commitment, spendingKey]);
    }

    /**
     * The Baby JubJub public key for a spending key: `BabyPbk(sk).Ax`.
     *
     * The circuits derive ownership this way rather than verifying a signature,
     * which is what lets them prove knowledge of the note's owner without an
     * EdDSA check — see the note at `circuits/transfer.circom:48`.
     */
    ownerPubkey(spendingKey: bigint): bigint {
        const point = this.babyJub.mulPointEscalar(this.babyJub.Base8, spendingKey);
        return this.F.toObject(point[0]);
    }

    /** Poseidon(owner_pubkey) — `value_proof`'s `owner_hash` output. */
    ownerHash(ownerPubkey: bigint): bigint {
        return this.hash([ownerPubkey]);
    }

    /**
     * A Merkle proof for one leaf in a sparse tree.
     *
     * Only the non-zero nodes are materialised, so the cost is proportional to
     * the number of leaves rather than to 2^depth — a dense tree at depth 20
     * would be a million nodes for the one or two leaves a test actually uses.
     */
    merkleProof(leaves: bigint[], leafIndex: number, depth = TREE_DEPTH): MerkleProof {
        const pathElements: bigint[] = [];
        const pathIndices: number[] = [];

        let level = new Map<number, bigint>();
        leaves.forEach((leaf, i) => level.set(i, leaf));

        for (let d = 0; d < depth; d++) {
            const nodeIdx = leafIndex >> d;
            const isRight = nodeIdx % 2 === 1;
            pathIndices.push(isRight ? 1 : 0);
            pathElements.push(level.get(isRight ? nodeIdx - 1 : nodeIdx + 1) ?? 0n);

            const next = new Map<number, bigint>();
            for (const [pos] of level) {
                const parent = pos >> 1;
                if (next.has(parent)) continue;
                const l = level.get(parent * 2) ?? 0n;
                const r = level.get(parent * 2 + 1) ?? 0n;
                next.set(parent, this.hash([l, r]));
            }
            level = next;
        }

        return { root: level.get(0) ?? 0n, pathElements, pathIndices };
    }

    /** A single-leaf tree, the shape most fixtures use. */
    singleLeafTree(leaf: bigint, leafIndex = 0, depth = TREE_DEPTH): MerkleProof {
        return this.merkleProof([leaf], leafIndex, depth);
    }
}
