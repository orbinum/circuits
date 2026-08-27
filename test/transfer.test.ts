import path from "path";
import { expect } from "chai";
import { wasm as wasm_tester } from "circom_tester";
import type { WasmTester } from "circom_tester";
import { needCircuit, requireArtifact } from "./helpers/artifacts";
import { NoteCrypto } from "../scripts/lib/note";

// ─── Constants ────────────────────────────────────────────────────────────────

const TREE_DEPTH = 20;

describe("Transfer Circuit (gasless)", function () {
    this.timeout(180_000);

    const circuitPath = path.join(__dirname, "..", "circuits", "transfer.circom");
    const outputDir = path.join(__dirname, "..", "build");
    const precompiledWasm = path.join(outputDir, "transfer_js", "transfer.wasm");

    let circuitOrUndefined: WasmTester | undefined;
    let note: NoteCrypto;

    // Default spending keys (same values as buildInput/buildDummyInput defaults)
    const SK0_DEFAULT = 0xdeadbeef0000001n;
    const SK1_DEFAULT = 0xdeadbeef0000002n;

    // Output note owner pubkeys (derived from default spending keys via BabyPbk)
    let alice: { Ax: bigint };
    let bob: { Ax: bigint };

    // ── Helpers ─────────────────────────────────────────────────────────────

    const computeCommitment = (
        value: bigint,
        assetId: bigint,
        ownerAx: bigint,
        blinding: bigint
    ): bigint => note.commitment(value, assetId, ownerAx, blinding);

    const computeNullifier = (commitment: bigint, spendingKey: bigint): bigint =>
        note.nullifier(commitment, spendingKey);

    /** Derive Baby JubJub owner public key (Ax) from a spending key scalar. Mirrors BabyPbk in circuit. */
    const computeOwnerAx = (sk: bigint): bigint => note.ownerPubkey(sk);

    /** Sparse Merkle proof builder. Only materialises the O(N·depth) non-zero nodes,
     *  keeping runtime proportional to the number of leaves, not 2^depth. */
    const buildMerkleProof = (
        leaves: bigint[],
        leafIndex: number
    ): { root: bigint; pathElements: bigint[]; pathIndices: number[] } =>
        note.merkleProof(leaves, leafIndex);

    /**
     * Build a complete valid transfer circuit input.
     * note0 (Alice) at index 0, note1 (Bob) at index 1 in the same tree.
     */
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

        // Derive owner pubkeys from spending keys — matches circuit's BabyPbk(spending_key).Ax
        const owner0Ax = computeOwnerAx(sk0);
        const owner1Ax = computeOwnerAx(sk1);

        const comm0 = computeCommitment(opts.value0, assetId, owner0Ax, bl0);
        const comm1 = computeCommitment(opts.value1, assetId, owner1Ax, bl1);

        const { root, pathElements: pe0, pathIndices: pi0 } = buildMerkleProof([comm0, comm1], 0);
        const { pathElements: pe1, pathIndices: pi1 } = buildMerkleProof([comm0, comm1], 1);

        const null0 = computeNullifier(comm0, sk0);
        const null1 = computeNullifier(comm1, sk1);

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
            input_path_elements: [pe0.map(String), pe1.map(String)],
            input_path_indices: [pi0, pi1],
            output_values: [opts.outValue0.toString(), opts.outValue1.toString()],
            output_asset_ids: [assetId.toString(), assetId.toString()],
            output_owner_pubkeys: [outOwner0.toString(), outOwner1.toString()],
            output_blindings: [outBl0.toString(), outBl1.toString()],
        };
    }

    /**
     * Build a transfer circuit input with one real note (Alice, index 0) and one dummy note
     * (input_values[1] = 0). The dummy bypasses Merkle, nullifier derivation, and EdDSA checks.
     * The dummy nullifier must be supplied as 0 in the public inputs.
     */
    function buildDummyInput(opts: {
        value0: bigint;
        outValue0: bigint;
        outValue1: bigint;
        fee: bigint;
        assetId?: bigint;
        blinding0?: bigint;
        spendingKey0?: bigint;
        outBlinding0?: bigint;
        outBlinding1?: bigint;
        outOwner0?: bigint;
        outOwner1?: bigint;
    }): any {
        const assetId = opts.assetId ?? 0n;
        const bl0 = opts.blinding0 ?? 0xaaaaaaaabbbbbbbbaaaaaaaabn;
        const sk0 = opts.spendingKey0 ?? 0xdeadbeef0000001n;
        const outBl0 = opts.outBlinding0 ?? 0x1111111100000001n;
        const outBl1 = opts.outBlinding1 ?? 0x2222222200000002n;
        const outOwner0 = opts.outOwner0 ?? alice.Ax;
        const outOwner1 = opts.outOwner1 ?? bob.Ax;

        // Real note (Alice, input[0]) — derive ownerAx from sk0 to match circuit's BabyPbk
        const owner0Ax = computeOwnerAx(sk0);
        const comm0 = computeCommitment(opts.value0, assetId, owner0Ax, bl0);
        const { root, pathElements: pe0, pathIndices: pi0 } = buildMerkleProof([comm0], 0);
        const null0 = computeNullifier(comm0, sk0);

        // Dummy note (input[1]): value=0, nullifier=0 (required by Constraint 9), all-zero path
        const zeroPE = Array(TREE_DEPTH).fill(0n);
        const zeroPI = Array(TREE_DEPTH).fill(0);

        const outComm0 = computeCommitment(opts.outValue0, assetId, outOwner0, outBl0);
        const outComm1 = computeCommitment(opts.outValue1, assetId, outOwner1, outBl1);

        return {
            merkle_root: root.toString(),
            nullifiers: [null0.toString(), "0"], // dummy nullifier must be 0
            commitments: [outComm0.toString(), outComm1.toString()],
            asset_id: assetId.toString(),
            fee: opts.fee.toString(),
            input_values: [opts.value0.toString(), "0"], // dummy has value = 0
            input_asset_ids: [assetId.toString(), assetId.toString()],
            input_blindings: [bl0.toString(), "0"],
            spending_keys: [sk0.toString(), "1"], // arbitrary for dummy (BabyPbk(1) is valid)
            input_path_elements: [pe0.map(String), zeroPE.map(String)],
            input_path_indices: [pi0, zeroPI],
            output_values: [opts.outValue0.toString(), opts.outValue1.toString()],
            output_asset_ids: [assetId.toString(), assetId.toString()],
            output_owner_pubkeys: [outOwner0.toString(), outOwner1.toString()],
            output_blindings: [outBl0.toString(), outBl1.toString()],
        };
    }

    // ── Setup ─────────────────────────────────────────────────────────────────

    before(async function () {
        note = await NoteCrypto.build();

        // Derive alice/bob pubkeys from their default spending keys via BabyPbk
        alice = { Ax: note.ownerPubkey(SK0_DEFAULT) };
        bob = { Ax: note.ownerPubkey(SK1_DEFAULT) };

        if (!requireArtifact(precompiledWasm, "transfer")) return;
        circuitOrUndefined = await wasm_tester(circuitPath, { output: outputDir, recompile: true });
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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

    // ── 3. Key derivation: BabyPbk(spending_key) → ownerPk (Constraint 3) ──────────────

    describe("Key derivation: BabyPbk(spending_key) \u2192 ownerPk (Constraint 3)", () => {
        it("accepts valid spending keys (both real notes)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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

        it("rejects wrong spending_key for input[0] (wrong Ax \u2192 commitment mismatch \u2192 Merkle fails)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
            const input = buildInput({
                value0: 300n,
                value1: 200n,
                outValue0: 499n,
                outValue1: 0n,
                fee: 1n,
            });
            // Tamper sk0: circuit derives wrong Ax, builds wrong commitment, Merkle check fails
            input.spending_keys[0] = "999999999999999";
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects wrong spending_key for input[1] (wrong Ax \u2192 commitment mismatch \u2192 Merkle fails)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
            const input = buildInput({
                value0: 300n,
                value1: 200n,
                outValue0: 499n,
                outValue1: 0n,
                fee: 1n,
            });
            input.spending_keys[1] = "111111111111111";
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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

    // ── 8. Distinct nullifiers (Constraint 10) ────────────────────────────────────────

    describe("Distinct nullifiers (Constraint 10)", () => {
        it("accepts two different notes (nullifiers always distinct)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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

    // ── 9. u128 range check (Constraint 6 & 6b) ──────────────────────────────

    describe("u128 range check (Constraint 6 & 6b)", () => {
        it("accepts 1000 ORB input notes", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
            const MAX_FEE = 2n ** 128n - 1n;
            // value1 = 0 triggers is_dummy → must use buildDummyInput so nullifiers[1] = 0
            const input = buildDummyInput({
                value0: MAX_FEE,
                outValue0: 0n,
                outValue1: 0n,
                fee: MAX_FEE,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects fee = 2^128 even when input/output values are valid u128", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
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

    // ── 10. Dummy note (Constraints 9 & 10) ────────────────────────────────────

    describe("Dummy note (Constraints 9 & 10)", () => {
        it("accepts 1 real note + dummy (value=0, nullifier=0)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
            const input = buildDummyInput({
                value0: 1000n,
                outValue0: 999n,
                outValue1: 0n,
                fee: 1n,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("accepts dummy with corrupted Merkle path (path is ignored)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
            const input = buildDummyInput({
                value0: 500n,
                outValue0: 499n,
                outValue1: 0n,
                fee: 1n,
            });
            // Corrupt the dummy path — should still pass (dummy bypasses Merkle check)
            input.input_path_elements[1][0] = "99999999";
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects dummy with non-zero nullifier (Constraint 9)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
            const input = buildDummyInput({
                value0: 500n,
                outValue0: 499n,
                outValue1: 0n,
                fee: 1n,
            });
            // Set dummy nullifier to non-zero — violates Constraint 9
            input.nullifiers[1] = "12345";
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("accepts different fee values with dummy input", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
            const fee = 1_000_000_000_000_000n; // 0.001 ORB
            const input = buildDummyInput({
                value0: 10_000_000_000_000_000_000n,
                outValue0: 10_000_000_000_000_000_000n - fee,
                outValue1: 0n,
                fee,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects wrong spending key for the real note in 1-real+dummy scenario (Constraint 2)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
            const input = buildDummyInput({
                value0: 500n,
                outValue0: 499n,
                outValue1: 0n,
                fee: 1n,
            });
            // Tamper the spending key of the real note — nullifier derivation must fail
            input.spending_keys[0] = "9999999999999999999";
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects tampered Merkle root for the real note in 1-real+dummy scenario (Constraint 1)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
            const input = buildDummyInput({
                value0: 500n,
                outValue0: 499n,
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

        it("accepts dummy as input[0], real as input[1] (symmetric positions)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "transfer", this);
            // Mirror of buildDummyInput: dummy at index 0, real note (Bob, sk1) at index 1
            const assetId = 0n;
            const bl1 = 0xccccccccddddddddccccccccdn;
            const sk1 = 0xdeadbeef0000002n;
            const outBl0 = 0x1111111100000001n;
            const outBl1 = 0x2222222200000002n;
            const value1 = 800n;

            // Derive owner Ax for the real note from sk1
            const owner1Ax = computeOwnerAx(sk1);
            const comm1 = computeCommitment(value1, assetId, owner1Ax, bl1);
            const { root, pathElements: pe1, pathIndices: pi1 } = buildMerkleProof([comm1], 0);
            const null1 = computeNullifier(comm1, sk1);

            const outComm0 = computeCommitment(799n, assetId, alice.Ax, outBl0);
            const outComm1 = computeCommitment(0n, assetId, bob.Ax, outBl1);

            const zeroPE = Array(TREE_DEPTH).fill(0n);
            const zeroPI = Array(TREE_DEPTH).fill(0);
            const input: any = {
                merkle_root: root.toString(),
                nullifiers: ["0", null1.toString()], // dummy nullifier is 0
                commitments: [outComm0.toString(), outComm1.toString()],
                asset_id: assetId.toString(),
                fee: "1",
                input_values: ["0", value1.toString()], // dummy at index 0
                input_asset_ids: [assetId.toString(), assetId.toString()],
                input_blindings: ["0", bl1.toString()],
                spending_keys: ["1", sk1.toString()], // BabyPbk(1) for dummy (valid point)
                input_path_elements: [zeroPE.map(String), pe1.map(String)],
                input_path_indices: [zeroPI, pi1],
                output_values: ["799", "0"],
                output_asset_ids: [assetId.toString(), assetId.toString()],
                output_owner_pubkeys: [alice.Ax.toString(), bob.Ax.toString()],
                output_blindings: [outBl0.toString(), outBl1.toString()],
            };

            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });
    });
});
