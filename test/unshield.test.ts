import path from "path";
import fs from "fs";
import { expect } from "chai";
import { wasm as wasm_tester } from "circom_tester";
import { buildPoseidon, buildBabyjub } from "circomlibjs";
import type { WasmTester } from "circom_tester";

// ─── Constants ────────────────────────────────────────────────────────────────

const TREE_DEPTH = 20;

describe("Unshield Circuit (gasless)", function () {
    this.timeout(120_000);

    const circuitPath = path.join(__dirname, "..", "circuits", "unshield.circom");
    const outputDir = path.join(__dirname, "..", "build");
    const precompiledWasm = path.join(outputDir, "unshield_js", "unshield.wasm");

    let circuit: WasmTester;
    let poseidon: any;
    let babyJub: any;
    let F: any;

    // ── Helpers ────────────────────────────────────────────────────────────────

    function computeCommitment(
        value: bigint,
        assetId: bigint,
        owner: bigint,
        blinding: bigint
    ): bigint {
        return F.toObject(poseidon([value, assetId, owner, blinding]));
    }

    function computeNullifier(commitment: bigint, spendingKey: bigint): bigint {
        return F.toObject(poseidon([commitment, spendingKey]));
    }

    /** Derive Baby JubJub owner public key (Ax) from a spending key scalar. Mirrors BabyPbk in circuit. */
    function computeOwnerAx(sk: bigint): bigint {
        const point = babyJub.mulPointEscalar(babyJub.Base8, sk);
        return F.toObject(point[0]);
    }

    /** Sparse Merkle proof builder. Only materialises the O(N·depth) non-zero nodes,
     *  keeping runtime proportional to the number of leaves, not 2^depth. */
    function buildMerkleProof(
        leaves: bigint[],
        leafIndex: number
    ): { root: bigint; pathElements: bigint[]; pathIndices: number[] } {
        const pathElements: bigint[] = [];
        const pathIndices: number[] = [];
        let level = new Map<number, bigint>();
        for (let i = 0; i < leaves.length; i++) level.set(i, leaves[i]);
        for (let d = 0; d < TREE_DEPTH; d++) {
            const nodeIdx = leafIndex >> d;
            const isRight = nodeIdx % 2 === 1;
            pathIndices.push(isRight ? 1 : 0);
            pathElements.push(level.get(isRight ? nodeIdx - 1 : nodeIdx + 1) ?? 0n);
            const nextLevel = new Map<number, bigint>();
            for (const [pos] of level) {
                const parentPos = pos >> 1;
                if (nextLevel.has(parentPos)) continue;
                const l = level.get(parentPos * 2) ?? 0n;
                const r = level.get(parentPos * 2 + 1) ?? 0n;
                nextLevel.set(parentPos, F.toObject(poseidon([l, r])));
            }
            level = nextLevel;
        }
        return { root: level.get(0) ?? 0n, pathElements, pathIndices };
    }

    /** Build a minimal valid circuit input. */
    function buildInput(opts: {
        noteValue: bigint;
        amount: bigint;
        fee: bigint;
        assetId?: bigint;
        blinding?: bigint;
        spendingKey?: bigint;
        recipient?: bigint;
        leafIndex?: number;
    }) {
        const assetId = opts.assetId ?? 0n;
        const blinding = opts.blinding ?? 0xfedcba0987654321n;
        const spendingKey = opts.spendingKey ?? 0xdeadbeefcafebaben;
        const recipient = opts.recipient ?? 0xaabbccddee112233n;
        const leafIndex = opts.leafIndex ?? 0;

        // Derive owner pubkey from spending_key — matches circuit's BabyPbk(spending_key).Ax
        const owner = computeOwnerAx(spendingKey);

        const commitment = computeCommitment(opts.noteValue, assetId, owner, blinding);
        const nullifier = computeNullifier(commitment, spendingKey);
        // Place the commitment at leafIndex in the tree; fill preceding positions with zero
        const leavesArr = new Array(leafIndex + 1).fill(0n);
        leavesArr[leafIndex] = commitment;
        const { root, pathElements, pathIndices } = buildMerkleProof(leavesArr, leafIndex);

        return {
            merkle_root: root.toString(),
            nullifier: nullifier.toString(),
            amount: opts.amount.toString(),
            recipient: recipient.toString(),
            asset_id: assetId.toString(),
            fee: opts.fee.toString(),
            note_value: opts.noteValue.toString(),
            note_asset_id: assetId.toString(),
            note_blinding: blinding.toString(),
            spending_key: spendingKey.toString(),
            path_elements: pathElements.map((e) => e.toString()),
            path_indices: pathIndices,
        };
    }

    // ── Setup ──────────────────────────────────────────────────────────────────

    before(async function () {
        poseidon = await buildPoseidon();
        babyJub = await buildBabyjub();
        F = poseidon.F;
        if (!fs.existsSync(precompiledWasm)) {
            console.log(
                "  ⚠  Pre-compiled wasm not found. Run 'pnpm build-all' to enable circuit tests."
            );
            return;
        }
        circuit = await wasm_tester(circuitPath, { output: outputDir, recompile: true });
    });

    // ── 1. Commitment arithmetic (no wasm needed) ─────────────────────────────

    describe("Commitment arithmetic", () => {
        it("is deterministic", () => {
            const c1 = computeCommitment(1000n, 0n, 0x1234n, 0x5678n);
            const c2 = computeCommitment(1000n, 0n, 0x1234n, 0x5678n);
            expect(c1).to.equal(c2);
        });

        it("changes with each field", () => {
            const base = computeCommitment(1000n, 0n, 0x1234n, 0x5678n);
            expect(computeCommitment(2000n, 0n, 0x1234n, 0x5678n)).to.not.equal(base);
            expect(computeCommitment(1000n, 1n, 0x1234n, 0x5678n)).to.not.equal(base);
            expect(computeCommitment(1000n, 0n, 0x9999n, 0x5678n)).to.not.equal(base);
            expect(computeCommitment(1000n, 0n, 0x1234n, 0x9999n)).to.not.equal(base);
        });

        it("nullifiers differ per (commitment, spendingKey)", () => {
            const c = computeCommitment(1000n, 0n, 0x1234n, 0x5678n);
            expect(computeNullifier(c, 0xdeadn)).to.not.equal(computeNullifier(c, 0xbeefn));
        });

        it("supports max u128 value", () => {
            const MAX = 2n ** 128n - 1n;
            const c = computeCommitment(MAX, 0n, 0x1234n, 0x5678n);
            expect(c).to.not.equal(0n);
        });
    });

    // ── 2. Gasless fee constraint: note_value === amount + fee ─────────────────

    describe("Gasless fee constraint (Constraint 1)", () => {
        it("note_value = amount + fee (fee = 0)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 1000n, amount: 1000n, fee: 0n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("note_value = amount + fee (fee > 0)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 101n, amount: 100n, fee: 1n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("note_value = amount + fee (realistic: 0.001 ORB fee)", async function () {
            if (!circuit) return this.skip();
            const FEE = 1_000_000_000_000_000n;
            const NOTE = 10_000_000_000_000_000_000n; // 10 ORB
            const input = buildInput({ noteValue: NOTE, amount: NOTE - FEE, fee: FEE });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("fee = entire note value (amount = 0, edge case)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 500n, amount: 0n, fee: 500n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects: old behaviour amount = note_value when fee > 0", async function () {
            if (!circuit) return this.skip();
            // Pre-gasless: amount == note_value. Now: amount + fee == note_value.
            // If fee=1 and amount=note_value, amount+fee overflows constraint.
            const input = buildInput({ noteValue: 1000n, amount: 1000n, fee: 1n });
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects: amount + fee > note_value", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 100n, amount: 90n, fee: 20n });
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects: amount > note_value (overspend)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 100n, amount: 200n, fee: 0n });
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 3. Merkle membership (Constraint 4) ───────────────────────────────────

    describe("Merkle membership (Constraint 4)", () => {
        it("accepts valid proof at index 0", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 1000n, amount: 999n, fee: 1n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("accepts valid proof at index 5", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 1000n, amount: 999n, fee: 1n, leafIndex: 5 });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects wrong Merkle root", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 1000n, amount: 999n, fee: 1n });
            input.merkle_root = (BigInt(input.merkle_root) + 1n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects wrong commitment (tampered spending_key → wrong Ax → commitment mismatch)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 1000n, amount: 999n, fee: 1n });
            // Change spending_key: circuit derives different Ax, builds different commitment,
            // Merkle check fails (derived commitment not in tree)
            input.spending_key = "99999999999999999";
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 4. Nullifier integrity (Constraint 5) ─────────────────────────────────

    describe("Nullifier integrity (Constraint 5)", () => {
        it("rejects tampered public nullifier", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 1000n, amount: 999n, fee: 1n });
            input.nullifier = (BigInt(input.nullifier) + 1n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects wrong spending_key", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                noteValue: 500n,
                amount: 499n,
                fee: 1n,
                spendingKey: 0xdeadn,
            });
            input.spending_key = "999999999"; // different key → different nullifier
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 5. Asset ID enforcement (Constraint 6) ────────────────────────────────

    describe("Asset ID enforcement (Constraint 6)", () => {
        it("accepts matching public asset_id and note asset_id", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 500n, amount: 499n, fee: 1n, assetId: 1n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects public asset_id ≠ note asset_id", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 500n, amount: 499n, fee: 1n, assetId: 1n });
            input.asset_id = "2"; // public says 2, note has 1
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 6. u128 range check (Constraints 2 & 3) ─────────────────────────────────

    describe("u128 range check (Constraints 2 & 3)", () => {
        it("accepts max u128 note value", async function () {
            if (!circuit) return this.skip();
            const MAX = 2n ** 128n - 1n;
            const FEE = 1n;
            const input = buildInput({ noteValue: MAX, amount: MAX - FEE, fee: FEE });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("accepts 1000 ORB (exceeds old u64 limit)", async function () {
            if (!circuit) return this.skip();
            const NOTE = 1000n * 10n ** 18n;
            const FEE = 1_000_000_000_000_000n;
            const input = buildInput({ noteValue: NOTE, amount: NOTE - FEE, fee: FEE });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("accepts max u128 fee (fee = 2^128 - 1)", async function () {
            if (!circuit) return this.skip();
            const MAX_FEE = 2n ** 128n - 1n;
            const input = buildInput({ noteValue: MAX_FEE, amount: 0n, fee: MAX_FEE });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects fee = 2^128 (exceeds u128)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({ noteValue: 0n, amount: 0n, fee: 0n });
            input.fee = (2n ** 128n).toString();
            input.note_value = (2n ** 128n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 7. Multi-asset support ─────────────────────────────────────────────────

    describe("Multi-asset support", () => {
        for (const [label, assetId] of [
            ["native (0)", 0n],
            ["USDT (1)", 1n],
            ["max u32 (4294967295)", 4294967295n],
        ] as const) {
            it(`accepts asset_id ${label}`, async function () {
                if (!circuit) return this.skip();
                const input = buildInput({
                    noteValue: 1000n,
                    amount: 999n,
                    fee: 1n,
                    assetId: BigInt(assetId),
                });
                const w = await circuit.calculateWitness(input);
                await circuit.checkConstraints(w);
            });
        }

        it("different asset_ids produce different commitments", () => {
            const base = (id: bigint) => computeCommitment(100n, id, 0x1234n, 0x5678n);
            expect(base(0n)).to.not.equal(base(1n));
            expect(base(1n)).to.not.equal(base(2n));
        });
    });
});
