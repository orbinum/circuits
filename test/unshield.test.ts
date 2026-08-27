import path from "path";
import { expect } from "chai";
import { wasm as wasm_tester } from "circom_tester";
import type { WasmTester } from "circom_tester";
import { needCircuit, requireArtifact } from "./helpers/artifacts";
import { NoteCrypto } from "../scripts/lib/note";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BuildInputOpts {
    noteValue: bigint;
    amount: bigint;
    fee: bigint;
    changeValue?: bigint; // default 0n (total unshield)
    changeBlinding?: bigint;
    changeOwnerPubkey?: bigint; // default: same owner as input note
    assetId?: bigint;
    blinding?: bigint;
    spendingKey?: bigint;
    recipient?: bigint;
    leafIndex?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe("Unshield Circuit (gasless)", function () {
    this.timeout(120_000);

    const circuitPath = path.join(__dirname, "..", "circuits", "unshield.circom");
    const outputDir = path.join(__dirname, "..", "build");
    const precompiledWasm = path.join(outputDir, "unshield_js", "unshield.wasm");

    let circuitOrUndefined: WasmTester | undefined;
    let note: NoteCrypto;

    // ── Helpers ────────────────────────────────────────────────────────────────

    const computeCommitment = (
        value: bigint,
        assetId: bigint,
        owner: bigint,
        blinding: bigint
    ): bigint => note.commitment(value, assetId, owner, blinding);

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

    /** Build a minimal valid circuit input. */
    function buildInput(opts: BuildInputOpts) {
        const assetId = opts.assetId ?? 0n;
        const blinding = opts.blinding ?? 0xfedcba0987654321n;
        const spendingKey = opts.spendingKey ?? 0xdeadbeefcafebaben;
        const recipient = opts.recipient ?? 0xaabbccddee112233n;
        const leafIndex = opts.leafIndex ?? 0;
        const changeValue = opts.changeValue ?? 0n;

        // Derive owner pubkey from spending_key — matches circuit's BabyPbk(spending_key).Ax
        const owner = computeOwnerAx(spendingKey);

        const commitment = computeCommitment(opts.noteValue, assetId, owner, blinding);
        const nullifier = computeNullifier(commitment, spendingKey);
        // Place the commitment at leafIndex in the tree; fill preceding positions with zero
        const leavesArr = new Array(leafIndex + 1).fill(0n);
        leavesArr[leafIndex] = commitment;
        const { root, pathElements, pathIndices } = buildMerkleProof(leavesArr, leafIndex);

        // Change note defaults: same owner, fresh blinding
        const changeOwnerPubkey = opts.changeOwnerPubkey ?? owner;
        const changeBlinding = opts.changeBlinding ?? 0xabcdef1234567890n;

        // change_commitment: 0 if no change, else NoteCommitment(changeValue, assetId, changeOwnerPubkey, changeBlinding)
        let changeCommitment = 0n;
        if (changeValue > 0n) {
            changeCommitment = computeCommitment(
                changeValue,
                assetId,
                changeOwnerPubkey,
                changeBlinding
            );
        }

        return {
            merkle_root: root.toString(),
            nullifier: nullifier.toString(),
            amount: opts.amount.toString(),
            recipient: recipient.toString(),
            asset_id: assetId.toString(),
            fee: opts.fee.toString(),
            change_commitment: changeCommitment.toString(),
            note_value: opts.noteValue.toString(),
            note_asset_id: assetId.toString(),
            note_blinding: blinding.toString(),
            spending_key: spendingKey.toString(),
            change_value: changeValue.toString(),
            change_blinding: changeBlinding.toString(),
            change_owner_pubkey: changeOwnerPubkey.toString(),
            path_elements: pathElements.map((e) => e.toString()),
            path_indices: pathIndices,
        };
    }

    // ── Setup ──────────────────────────────────────────────────────────────────

    before(async function () {
        note = await NoteCrypto.build();
        if (!requireArtifact(precompiledWasm, "unshield")) return;
        circuitOrUndefined = await wasm_tester(circuitPath, { output: outputDir, recompile: true });
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

    // ── 2. Conservation of value: note_value === amount + fee + change_value ────

    describe("Conservation of value (Constraint 1)", () => {
        it("total unshield: note_value = amount + fee, change_value = 0 (fee = 0)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 1000n, amount: 1000n, fee: 0n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("total unshield: note_value = amount + fee (fee > 0)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 101n, amount: 100n, fee: 1n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("total unshield: realistic 0.001 ORB fee", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const FEE = 1_000_000_000_000_000n;
            const NOTE = 10_000_000_000_000_000_000n; // 10 ORB
            const input = buildInput({ noteValue: NOTE, amount: NOTE - FEE, fee: FEE });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("total unshield: fee = entire note value (amount = 0)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 500n, amount: 0n, fee: 500n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("partial unshield: amount = 50, fee = 1, change = 49, note = 100", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 100n, amount: 50n, fee: 1n, changeValue: 49n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("partial unshield: amount = 1, fee = 0, change = note-1", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const NOTE = 1_000_000n;
            const input = buildInput({
                noteValue: NOTE,
                amount: 1n,
                fee: 0n,
                changeValue: NOTE - 1n,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("partial unshield: realistic — withdraw 5 ORB from 10 ORB note", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const ORB = 10n ** 18n;
            const NOTE = 10n * ORB;
            const AMOUNT = 5n * ORB;
            const FEE = 1_000_000_000_000_000n;
            const CHANGE = NOTE - AMOUNT - FEE;
            const input = buildInput({
                noteValue: NOTE,
                amount: AMOUNT,
                fee: FEE,
                changeValue: CHANGE,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects: amount + fee + change_value > note_value", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 100n, amount: 50n, fee: 1n, changeValue: 60n }); // 111 > 100
            // Override the conservation: make note_value inconsistent
            // We need to keep note_value as 100 but amount+fee+change = 111
            // buildInput sets note_value = 100, but the constraint requires 100 === 50+1+60 = 111
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects: amount = note_value when fee > 0 and change = 0 (old over-spend pattern)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            // noteValue=1000, amount=1000, fee=1, change=0 → 1000 ≠ 1001
            const input = buildInput({ noteValue: 1000n, amount: 1000n, fee: 1n });
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("rejects: amount > note_value (overspend)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 100n, amount: 200n, fee: 0n });
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 3. Merkle membership (Constraint 5) ───────────────────────────────────

    describe("Merkle membership (Constraint 5)", () => {
        it("accepts valid proof at index 0", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 1000n, amount: 999n, fee: 1n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("accepts valid proof at index 5", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 1000n, amount: 999n, fee: 1n, leafIndex: 5 });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects wrong Merkle root", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
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
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
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

    // ── 4. Nullifier integrity (Constraint 6) ─────────────────────────────────

    describe("Nullifier integrity (Constraint 6)", () => {
        it("rejects tampered public nullifier", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
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
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
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

    // ── 5. Asset ID enforcement (Constraint 7) ────────────────────────────────

    describe("Asset ID enforcement (Constraint 7)", () => {
        it("accepts matching public asset_id and note asset_id", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 500n, amount: 499n, fee: 1n, assetId: 1n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects public asset_id ≠ note asset_id", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
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
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const MAX = 2n ** 128n - 1n;
            const FEE = 1n;
            const input = buildInput({ noteValue: MAX, amount: MAX - FEE, fee: FEE });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("accepts 1000 ORB (exceeds old u64 limit)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const NOTE = 1000n * 10n ** 18n;
            const FEE = 1_000_000_000_000_000n;
            const input = buildInput({ noteValue: NOTE, amount: NOTE - FEE, fee: FEE });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("accepts max u128 fee (fee = 2^128 - 1)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const MAX_FEE = 2n ** 128n - 1n;
            const input = buildInput({ noteValue: MAX_FEE, amount: 0n, fee: MAX_FEE });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("rejects fee = 2^128 (exceeds u128)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
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
                const circuit = needCircuit(circuitOrUndefined, "unshield", this);
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

    // ── 8. Change note commitment (Constraint 8) ──────────────────────────────

    describe("Change note commitment (Constraint 8)", () => {
        // ── 8a: total unshield (change_value == 0) ────────────────────────────

        it("total unshield: change_commitment = 0 is accepted", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            // change_value = 0 by default → change_commitment = 0
            const input = buildInput({ noteValue: 100n, amount: 99n, fee: 1n });
            expect(input.change_value).to.equal("0");
            expect(input.change_commitment).to.equal("0");
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("total unshield: rejects non-zero change_commitment when change_value = 0 (Constraint 8b)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 100n, amount: 99n, fee: 1n });
            // Force a non-zero change_commitment while keeping change_value = 0
            input.change_commitment = "12345678901234567890";
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        // ── 8b: partial unshield (change_value > 0) ───────────────────────────

        it("partial unshield: correct change_commitment is accepted (Constraint 8a)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 100n, amount: 50n, fee: 1n, changeValue: 49n });
            expect(input.change_value).to.equal("49");
            expect(input.change_commitment).to.not.equal("0");
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("partial unshield: tampered change_commitment is rejected (Constraint 8a)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 100n, amount: 50n, fee: 1n, changeValue: 49n });
            input.change_commitment = (BigInt(input.change_commitment) + 1n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("partial unshield: change_commitment = 0 when change_value > 0 is rejected (Constraint 8a)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 100n, amount: 50n, fee: 1n, changeValue: 49n });
            // Zero out the public change_commitment — must be rejected
            input.change_commitment = "0";
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("partial unshield: wrong change_blinding produces wrong commitment → rejected", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({
                noteValue: 200n,
                amount: 100n,
                fee: 1n,
                changeValue: 99n,
                changeBlinding: 0x1111n,
            });
            // Tamper the private blinding after computing the public commitment
            input.change_blinding = "9999999999999";
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("partial unshield: wrong change_owner_pubkey produces wrong commitment → rejected", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const sk = 0xdeadbeefcafebaben;
            const owner = computeOwnerAx(sk);
            // Build input with the correct owner
            const input = buildInput({
                noteValue: 200n,
                amount: 100n,
                fee: 1n,
                changeValue: 100n,
                changeOwnerPubkey: owner,
                spendingKey: sk,
            });
            // Tamper the private change_owner_pubkey after computing the commitment
            input.change_owner_pubkey = (owner + 1n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("partial unshield: change_commitment forged with wrong asset_id → rejected (Constraint 8a)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            // The circuit pins the change commitment to note_asset_id (== public asset_id, Constraint 7).
            // A change_commitment computed with any other asset_id must be rejected.
            const ASSET = 1n;
            const input = buildInput({
                noteValue: 100n,
                amount: 50n,
                fee: 1n,
                changeValue: 49n,
                assetId: ASSET,
            });
            // Forge the public change_commitment using asset_id = 0 instead of 1
            const changeOwnerPubkey = BigInt(input.change_owner_pubkey);
            const changeBlinding = BigInt(input.change_blinding);
            const forged = computeCommitment(
                49n,
                0n /* wrong asset */,
                changeOwnerPubkey,
                changeBlinding
            );
            input.change_commitment = forged.toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        // ── 8c: same owner for change note (self-change) ─────────────────────

        it("partial unshield: change note to same owner is accepted", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const sk = 0xabcdef1234567890n;
            const owner = computeOwnerAx(sk);
            const input = buildInput({
                noteValue: 1000n,
                amount: 600n,
                fee: 1n,
                changeValue: 399n,
                changeOwnerPubkey: owner, // same owner = self-change
                spendingKey: sk,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("partial unshield: change note to different owner is accepted", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const sk = 0xabcdef1234567890n;
            const otherOwner = computeOwnerAx(0x9988776655443322n); // different key
            const input = buildInput({
                noteValue: 1000n,
                amount: 600n,
                fee: 1n,
                changeValue: 399n,
                changeOwnerPubkey: otherOwner, // different owner
                spendingKey: sk,
            });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        // ── 8d: change_value range checks (Constraint 9) ─────────────────────

        it("change_value range: accepts max u128 change (note_value = max u128)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const MAX = 2n ** 128n - 1n;
            // note_value = MAX, amount = 0, fee = 0, change = MAX
            // Conservation: MAX === 0 + 0 + MAX ✓
            // Both note_value and change_value pass Num2Bits(128) since MAX = 2^128 - 1 fits exactly.
            const input = buildInput({ noteValue: MAX, amount: 0n, fee: 0n, changeValue: MAX });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
        });

        it("change_value range: rejects change_value = 2^128 (exceeds u128)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 0n, amount: 0n, fee: 0n });
            // change_value = 2^128: both conservation (0 ≠ 2^128) and Num2Bits(128) fail.
            input.change_value = (2n ** 128n).toString();
            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── 9. Public signals set (Constraint 8 — public API) ─────────────────────

    describe("Public signals", () => {
        it("total unshield exposes change_commitment = 0 as public signal", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 100n, amount: 99n, fee: 1n });
            const w = await circuit.calculateWitness(input);
            // Public signals: [1, merkle_root, nullifier, amount, recipient, asset_id, fee, change_commitment]
            // change_commitment is the 8th public signal (index 7 after the constant 1)
            // We verify indirectly: constraint check passes and change_commitment is 0
            await circuit.checkConstraints(w);
            expect(input.change_commitment).to.equal("0");
        });

        it("partial unshield exposes correct non-zero change_commitment as public signal", async function () {
            const circuit = needCircuit(circuitOrUndefined, "unshield", this);
            const input = buildInput({ noteValue: 100n, amount: 50n, fee: 1n, changeValue: 49n });
            const w = await circuit.calculateWitness(input);
            await circuit.checkConstraints(w);
            expect(input.change_commitment).to.not.equal("0");
        });
    });
});
