import path from "path";
import fs from "fs";
import { expect } from "chai";
import { wasm as wasm_tester } from "circom_tester";
import { buildPoseidon, buildEddsa } from "circomlibjs";
import type { WasmTester } from "circom_tester";

// ─── Constants ────────────────────────────────────────────────────────────────

const TREE_DEPTH = 20;

describe("Transfer Circuit (gasless)", function () {
    this.timeout(180_000);

    const circuitPath = path.join(__dirname, "..", "circuits", "transfer.circom");
    const outputDir = path.join(__dirname, "..", "build");
    const precompiledWasm = path.join(outputDir, "transfer_js", "transfer.wasm");

    let circuit: WasmTester;
    let poseidon: any;
    let eddsa: any;
    let F: any;

    // Two test key pairs (Alice owns note 0, Bob owns note 1)
    let alice: { privKey: Buffer; Ax: bigint; Ay: bigint };
    let bob: { privKey: Buffer; Ax: bigint; Ay: bigint };

    // ── Helpers ─────────────────────────────────────────────────────────────

    function computeCommitment(
        value: bigint,
        assetId: bigint,
        ownerAx: bigint,
        blinding: bigint
    ): bigint {
        return F.toObject(poseidon([value, assetId, ownerAx, blinding]));
    }

    function computeNullifier(commitment: bigint, spendingKey: bigint): bigint {
        return F.toObject(poseidon([commitment, spendingKey]));
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

    /** Generate an EdDSA Poseidon signature over a field element. */
    function sign(privKey: Buffer, commitment: bigint): { R8x: bigint; R8y: bigint; S: bigint } {
        const sig = eddsa.signPoseidon(privKey, F.e(commitment));
        return {
            R8x: F.toObject(sig.R8[0]),
            R8y: F.toObject(sig.R8[1]),
            S: sig.S,
        };
    }

    /**
     * Build a complete valid transfer circuit input.
     * note0 (Alice) at index 0, note1 (Bob) at index 1 in the same tree.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function buildInput(opts: {
        value0: bigint;
        value1: bigint;
        outValue0: bigint;
        outValue1: bigint;
        fee: bigint;
        assetId?: bigint;
        blinding0?: bigint;
        blinding1?: bigint;
        spendingKey0?: bigint;
        spendingKey1?: bigint;
        outBlinding0?: bigint;
        outBlinding1?: bigint;
        outOwner0?: bigint;
        outOwner1?: bigint;
    }): any {
        const assetId = opts.assetId ?? 0n;
        const bl0 = opts.blinding0 ?? 0xaaaaaaaabbbbbbbbaaaaaaaabn;
        const bl1 = opts.blinding1 ?? 0xccccccccddddddddccccccccdn;
        const sk0 = opts.spendingKey0 ?? 0xdeadbeef0000001n;
        const sk1 = opts.spendingKey1 ?? 0xdeadbeef0000002n;
        const outBl0 = opts.outBlinding0 ?? 0x1111111100000001n;
        const outBl1 = opts.outBlinding1 ?? 0x2222222200000002n;
        const outOwner0 = opts.outOwner0 ?? alice.Ax;
        const outOwner1 = opts.outOwner1 ?? bob.Ax;

        const comm0 = computeCommitment(opts.value0, assetId, alice.Ax, bl0);
        const comm1 = computeCommitment(opts.value1, assetId, bob.Ax, bl1);

        const { root, pathElements: pe0, pathIndices: pi0 } = buildMerkleProof([comm0, comm1], 0);
        const { pathElements: pe1, pathIndices: pi1 } = buildMerkleProof([comm0, comm1], 1);

        const null0 = computeNullifier(comm0, sk0);
        const null1 = computeNullifier(comm1, sk1);

        const sigA = sign(alice.privKey, comm0);
        const sigB = sign(bob.privKey, comm1);

        const outComm0 = computeCommitment(opts.outValue0, assetId, outOwner0, outBl0);
        const outComm1 = computeCommitment(opts.outValue1, assetId, outOwner1, outBl1);

        return {
            merkle_root: root.toString(),
            nullifiers: [null0.toString(), null1.toString()],
            commitments: [outComm0.toString(), outComm1.toString()],
            asset_id: assetId.toString(),
            fee: opts.fee.toString(),
            input_values: [opts.value0.toString(), opts.value1.toString()],
            input_asset_ids: [assetId.toString(), assetId.toString()],
            input_blindings: [bl0.toString(), bl1.toString()],
            spending_keys: [sk0.toString(), sk1.toString()],
            input_owner_Ax: [alice.Ax.toString(), bob.Ax.toString()],
            input_owner_Ay: [alice.Ay.toString(), bob.Ay.toString()],
            input_sig_R8x: [sigA.R8x.toString(), sigB.R8x.toString()],
            input_sig_R8y: [sigA.R8y.toString(), sigB.R8y.toString()],
            input_sig_S: [sigA.S.toString(), sigB.S.toString()],
            input_path_elements: [pe0.map(String), pe1.map(String)],
            input_path_indices: [pi0, pi1],
            output_values: [opts.outValue0.toString(), opts.outValue1.toString()],
            output_asset_ids: [assetId.toString(), assetId.toString()],
            output_owner_pubkeys: [outOwner0.toString(), outOwner1.toString()],
            output_blindings: [outBl0.toString(), outBl1.toString()],
        };
    }

    // ── Setup ─────────────────────────────────────────────────────────────────

    before(async function () {
        poseidon = await buildPoseidon();
        eddsa = await buildEddsa();
        F = poseidon.F;

        alice = (() => {
            const privKey = Buffer.from(
                "0001020304050607080900010203040506070809000102030405060708090001",
                "hex"
            );
            const pub = eddsa.prv2pub(privKey);
            return { privKey, Ax: F.toObject(pub[0]), Ay: F.toObject(pub[1]) };
        })();
        bob = (() => {
            const privKey = Buffer.from(
                "0102030405060708090001020304050607080900010203040506070809000102",
                "hex"
            );
            const pub = eddsa.prv2pub(privKey);
            return { privKey, Ax: F.toObject(pub[0]), Ay: F.toObject(pub[1]) };
        })();

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
            const c1 = computeCommitment(100n, 0n, 0xabcdn, 0xef01n);
            const c2 = computeCommitment(100n, 0n, 0xabcdn, 0xef01n);
            expect(c1).to.equal(c2);
        });

        it("changes with each field", () => {
            const base = computeCommitment(100n, 0n, 0xabcdn, 0xef01n);
            expect(computeCommitment(200n, 0n, 0xabcdn, 0xef01n)).not.to.equal(base);
            expect(computeCommitment(100n, 1n, 0xabcdn, 0xef01n)).not.to.equal(base);
            expect(computeCommitment(100n, 0n, 0x9999n, 0xef01n)).not.to.equal(base);
            expect(computeCommitment(100n, 0n, 0xabcdn, 0x1234n)).not.to.equal(base);
        });

        it("nullifiers differ per (commitment, spendingKey)", () => {
            const c = computeCommitment(100n, 0n, 0xabcdn, 0xef01n);
            expect(computeNullifier(c, 0xdeadn)).not.to.equal(computeNullifier(c, 0xbeefn));
        });

        it("supports max u128 value", () => {
            const MAX = 2n ** 128n - 1n;
            const c = computeCommitment(MAX, 0n, 0xabcdn, 0xef01n);
            expect(c).not.to.equal(0n);
        });
    });

    // ── 2. Gasless fee constraint: input_sum === output_sum + fee (Constraint 5) ──

    describe("Gasless fee constraint (Constraint 5)", () => {
        it("accepts fee = 0 (input_sum = output_sum)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 500n,
                value1: 500n,
                outValue0: 600n,
                outValue1: 400n,
                fee: 0n,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("accepts fee > 0: input_sum = output_sum + fee", async function () {
            if (!circuit) return this.skip();
            const fee = 1_000_000_000_000_000n; // 0.001 ORB
            const inSum = 10_000_000_000_000_000_000n; // 10 ORB total input
            const outA = inSum - fee;
            const input = buildInput({
                value0: inSum / 2n,
                value1: inSum / 2n,
                outValue0: outA,
                outValue1: 0n,
                fee,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("accepts fee = entire input (all to fee, output = 0 + 0)", async function () {
            if (!circuit) return this.skip();
            const total = 1000n;
            const input = buildInput({
                value0: 600n,
                value1: 400n,
                outValue0: 0n,
                outValue1: 0n,
                fee: total,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects: pre-gasless balance (output = input, fee = 1 → constraint failure)", async function () {
            if (!circuit) return this.skip();
            // input_sum=1000, output_sum=1000, fee=1 → 1000 ≠ 1001
            const input = buildInput({
                value0: 500n,
                value1: 500n,
                outValue0: 600n,
                outValue1: 400n,
                fee: 1n,
            });
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects: outputs exceed inputs (theft attempt)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 100n,
                value1: 100n,
                outValue0: 150n,
                outValue1: 100n,
                fee: 0n,
            });
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 3. EdDSA ownership (Constraint 3) ─────────────────────────────────────

    describe("EdDSA ownership (Constraint 3)", () => {
        it("accepts valid signatures from both owners", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 300n,
                value1: 200n,
                outValue0: 499n,
                outValue1: 0n,
                fee: 1n,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects tampered signature S component", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 300n,
                value1: 200n,
                outValue0: 499n,
                outValue1: 0n,
                fee: 1n,
            });
            input.input_sig_S[0] = (BigInt(input.input_sig_S[0]) + 1n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects mismatched public key (wrong owner for note)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 300n,
                value1: 200n,
                outValue0: 499n,
                outValue1: 0n,
                fee: 1n,
            });
            // Swap Alice's pubkey for Bob's — commitment was built with Alice's Ax, so this mismatches
            input.input_owner_Ax[0] = bob.Ax.toString();
            input.input_owner_Ay[0] = bob.Ay.toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 4. Nullifier integrity (Constraint 2) ─────────────────────────────────

    describe("Nullifier integrity (Constraint 2)", () => {
        it("rejects tampered public nullifier[0]", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 200n,
                value1: 300n,
                outValue0: 498n,
                outValue1: 0n,
                fee: 2n,
            });
            input.nullifiers[0] = (BigInt(input.nullifiers[0]) + 1n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects wrong spending_key[1]", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 200n,
                value1: 300n,
                outValue0: 498n,
                outValue1: 0n,
                fee: 2n,
            });
            input.spending_keys[1] = "999999999999999999";
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 5. Merkle membership (Constraint 1) ───────────────────────────────────

    describe("Merkle membership (Constraint 1)", () => {
        it("rejects wrong Merkle root", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 200n,
                value1: 200n,
                outValue0: 399n,
                outValue1: 0n,
                fee: 1n,
            });
            input.merkle_root = (BigInt(input.merkle_root) + 1n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects tampered path sibling", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 200n,
                value1: 200n,
                outValue0: 399n,
                outValue1: 0n,
                fee: 1n,
            });
            input.input_path_elements[0][0] = (
                BigInt(input.input_path_elements[0][0]) + 1n
            ).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 6. Output commitment verification (Constraint 4) ─────────────────────

    describe("Output commitment verification (Constraint 4)", () => {
        it("rejects tampered public output commitment", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 300n,
                value1: 200n,
                outValue0: 499n,
                outValue1: 0n,
                fee: 1n,
            });
            input.commitments[0] = (BigInt(input.commitments[0]) + 1n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 7. Asset ID enforcement (Constraints 7 & 8) ───────────────────────────

    describe("Asset ID enforcement (Constraints 7 & 8)", () => {
        it("accepts non-native asset (USDT, asset_id = 1)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 500n,
                value1: 500n,
                outValue0: 999n,
                outValue1: 0n,
                fee: 1n,
                assetId: 1n,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects public asset_id ≠ input note asset_id (Constraint 8)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 500n,
                value1: 500n,
                outValue0: 999n,
                outValue1: 0n,
                fee: 1n,
                assetId: 0n,
            });
            input.asset_id = "1"; // public claims 1, notes have 0
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects mixed-asset inputs: input_asset_ids[1] ≠ input_asset_ids[0] (Constraint 7)", async function () {
            if (!circuit) return this.skip();
            // Build a valid 2-note input where note1 has a different asset_id (1 vs 0)
            const input = buildInput({
                value0: 500n,
                value1: 500n,
                outValue0: 999n,
                outValue1: 0n,
                fee: 1n,
                assetId: 0n,
            });
            // Tamper note1's private asset_id — circuit enforces input_asset_ids[0] === input_asset_ids[1]
            input.input_asset_ids[1] = "1";
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects mixed-asset output: output_asset_ids[0] ≠ input_asset_ids[0] (Constraint 7)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 500n,
                value1: 500n,
                outValue0: 999n,
                outValue1: 0n,
                fee: 1n,
                assetId: 0n,
            });
            // Tamper one output note's private asset_id
            input.output_asset_ids[0] = "1";
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("different asset_ids produce different commitments", () => {
            const base = (id: bigint) => computeCommitment(100n, id, alice.Ax, 0x5678n);
            expect(base(0n)).not.to.equal(base(1n));
            expect(base(1n)).not.to.equal(base(2n));
        });
    });

    // ── 8. Distinct nullifiers (Constraint 9) ───────────────────────────────

    describe("Distinct nullifiers (Constraint 9)", () => {
        it("accepts two different notes (nullifiers always distinct)", async function () {
            if (!circuit) return this.skip();
            const input = buildInput({
                value0: 500n,
                value1: 500n,
                outValue0: 999n,
                outValue1: 0n,
                fee: 1n,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects duplicate nullifiers (same note spent twice in one tx)", async function () {
            if (!circuit) return this.skip();
            // Both input notes are the same: 500 + 500 = 999 + 0 + 1, conservation holds.
            // Without this constraint the circuit accepts and gives 2× value from one note.
            const input = buildInput({
                value0: 500n,
                value1: 500n,
                outValue0: 999n,
                outValue1: 0n,
                fee: 1n,
            });
            input.nullifiers[1] = input.nullifiers[0]; // same nullifier = same note
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 9. u128 range check (Constraint 6 & 6b) ─────────────────────────────

    describe("u128 range check (Constraint 6 & 6b)", () => {
        it("accepts 1000 ORB input notes", async function () {
            if (!circuit) return this.skip();
            const ORB = 10n ** 18n;
            const fee = 1_000_000_000_000_000n;
            const halfIn = 500n * ORB;
            const input = buildInput({
                value0: halfIn,
                value1: halfIn,
                outValue0: 2n * halfIn - fee,
                outValue1: 0n,
                fee,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("accepts max u128 fee with matching inputs", async function () {
            if (!circuit) return this.skip();
            const MAX_FEE = 2n ** 128n - 1n;
            const input = buildInput({
                value0: MAX_FEE,
                value1: 0n,
                outValue0: 0n,
                outValue1: 0n,
                fee: MAX_FEE,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects fee = 2^128 even when input/output values are valid u128", async function () {
            if (!circuit) return this.skip();
            const HALF = 2n ** 127n;
            const input = buildInput({
                value0: HALF,
                value1: HALF,
                outValue0: 0n,
                outValue1: 0n,
                fee: 0n,
            });
            input.fee = (2n ** 128n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });
});
