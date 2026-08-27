import path from "path";
import fs from "fs";
import { expect } from "chai";
import { wasm as wasm_tester } from "circom_tester";
import type { WasmTester } from "circom_tester";

import { NoteCrypto } from "./helpers/circuit-inputs";

// ─── Constants ────────────────────────────────────────────────────────────────

// Deterministic test scalars (well within BN254 scalar field)
const OWNER_PUBKEY = 0xdeadbeef_cafebabe_12345678_90abcdefn;
const BLINDING = 0xfedcba09_87654321_aabbccdd_eeff0011n;
const VALUE = 1_000n; // u64 relay fee amount
const ASSET_ID = 0n; // native asset

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe("ValueProof Circuit", function () {
    this.timeout(120_000);

    const circuitPath = path.join(__dirname, "..", "circuits", "value_proof.circom");
    const outputDir = path.join(__dirname, "..", "build");
    const precompiledWasm = path.join(outputDir, "value_proof_js", "value_proof.wasm");

    let circuit: WasmTester;
    let note: NoteCrypto;

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    before(async function () {
        note = await NoteCrypto.build();

        const recompile = !fs.existsSync(precompiledWasm);
        circuit = await wasm_tester(circuitPath, { output: outputDir, recompile });
    });

    // ── Pure helpers ───────────────────────────────────────────────────────────

    // The note primitives live in ./helpers/circuit-inputs, shared with the
    // other circuit suites and with make-fixture.ts. These thin aliases keep
    // the cases below reading the way they did.
    const computeCommitment = (
        value: bigint,
        assetId: bigint,
        ownerPubkey: bigint,
        blinding: bigint
    ): bigint => note.commitment(value, assetId, ownerPubkey, blinding);

    const computeOwnerHash = (ownerPubkey: bigint): bigint => note.ownerHash(ownerPubkey);

    /** Build a valid circuit input for the given parameters. */
    function buildInput(
        opts: {
            value?: bigint;
            assetId?: bigint;
            ownerPubkey?: bigint;
            blinding?: bigint;
            commitment?: bigint; // override commitment (to test mismatches)
        } = {}
    ) {
        const value = opts.value ?? VALUE;
        const assetId = opts.assetId ?? ASSET_ID;
        const ownerPubkey = opts.ownerPubkey ?? OWNER_PUBKEY;
        const blinding = opts.blinding ?? BLINDING;
        const commitment =
            opts.commitment ?? computeCommitment(value, assetId, ownerPubkey, blinding);

        return {
            commitment: commitment.toString(),
            value: value.toString(),
            asset_id: assetId.toString(),
            owner_pubkey: ownerPubkey.toString(),
            blinding: blinding.toString(),
        };
    }

    // ── Happy-path tests ───────────────────────────────────────────────────────

    describe("valid inputs", () => {
        it("should satisfy all constraints", async () => {
            const input = buildInput();
            const witness = await circuit.calculateWitness(input);
            await circuit.checkConstraints(witness);
        });

        it("should output owner_hash = Poseidon(owner_pubkey)", async () => {
            const input = buildInput();
            const witness = await circuit.calculateWitness(input);
            await circuit.checkConstraints(witness);

            // witness[1] is the first output signal — owner_hash
            const gotOwnerHash = witness[1];
            const expectedOwnerHash = computeOwnerHash(OWNER_PUBKEY);

            expect(gotOwnerHash.toString()).to.equal(expectedOwnerHash.toString());
        });

        it("should be deterministic for the same inputs", async () => {
            const input = buildInput();
            const witness1 = await circuit.calculateWitness(input);
            const witness2 = await circuit.calculateWitness(input);

            expect(witness1[1].toString()).to.equal(witness2[1].toString());
        });

        it("should work for value = 0 (zero-amount note)", async () => {
            const input = buildInput({ value: 0n });
            const witness = await circuit.calculateWitness(input);
            await circuit.checkConstraints(witness);
        });

        it("should work for maximum u64 value", async () => {
            const maxU64 = (1n << 64n) - 1n; // 18_446_744_073_709_551_615
            const input = buildInput({ value: maxU64 });
            const witness = await circuit.calculateWitness(input);
            await circuit.checkConstraints(witness);
        });

        it("should work with non-zero asset_id", async () => {
            const input = buildInput({ assetId: 42n });
            const witness = await circuit.calculateWitness(input);
            await circuit.checkConstraints(witness);
        });

        it("owner_hash differs when owner_pubkey differs", async () => {
            const input1 = buildInput({ ownerPubkey: 111n });
            const input2 = buildInput({ ownerPubkey: 222n });

            const w1 = await circuit.calculateWitness(input1);
            const w2 = await circuit.calculateWitness(input2);

            expect(w1[1].toString()).to.not.equal(w2[1].toString());
        });
    });

    // ── Constraint-violation tests ─────────────────────────────────────────────

    describe("invalid inputs — constraint violations", () => {
        it("should fail when commitment does not match preimage (wrong value)", async () => {
            // Commitment built for VALUE=1000 but circuit receives value=10000
            const commitment = computeCommitment(VALUE, ASSET_ID, OWNER_PUBKEY, BLINDING);
            const input = buildInput({ value: 10_000n, commitment });

            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("should fail when commitment does not match preimage (wrong asset_id)", async () => {
            const commitment = computeCommitment(VALUE, ASSET_ID, OWNER_PUBKEY, BLINDING);
            const input = buildInput({ assetId: 99n, commitment });

            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("should fail when commitment does not match preimage (wrong blinding)", async () => {
            const commitment = computeCommitment(VALUE, ASSET_ID, OWNER_PUBKEY, BLINDING);
            const input = buildInput({ blinding: 0xdeadbeefn, commitment });

            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("should fail when commitment does not match preimage (wrong owner_pubkey)", async () => {
            const commitment = computeCommitment(VALUE, ASSET_ID, OWNER_PUBKEY, BLINDING);
            const input = buildInput({ ownerPubkey: 0xcafebaben, commitment });

            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("should fail when commitment is zero (trivially invalid)", async () => {
            const input = buildInput({ commitment: 0n });

            try {
                await circuit.calculateWitness(input);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });
    });

    // ── Inflation-attack test ──────────────────────────────────────────────────

    describe("inflation attack prevention", () => {
        it("should reject a commitment built with value=1000 when claiming value=10000", async () => {
            // Scenario: relayer has 1000 pending fees.
            // Attacker builds commitment = Poseidon(1000, asset_id, pk, r).
            // Then tries to call claim_shielded_fees with value=10000 in the
            // public signals, hoping to unshield 10000 later.
            // The circuit MUST reject this because the commitment was built
            // for 1000, not 10000.

            const honestCommitment = computeCommitment(1000n, ASSET_ID, OWNER_PUBKEY, BLINDING);

            const attackInput = {
                commitment: honestCommitment.toString(),
                value: "10000", // ← inflated claim
                asset_id: ASSET_ID.toString(),
                owner_pubkey: OWNER_PUBKEY.toString(),
                blinding: BLINDING.toString(),
            };

            try {
                await circuit.calculateWitness(attackInput);
                expect.fail("Should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Assert Failed");
            }
        });

        it("a valid commitment must use the exact value in the public signal", async () => {
            // Confirm the positive case: honest relayer with matching value passes.
            const value = 1000n;
            const commitment = computeCommitment(value, ASSET_ID, OWNER_PUBKEY, BLINDING);

            const honestInput = {
                commitment: commitment.toString(),
                value: value.toString(),
                asset_id: ASSET_ID.toString(),
                owner_pubkey: OWNER_PUBKEY.toString(),
                blinding: BLINDING.toString(),
            };

            const witness = await circuit.calculateWitness(honestInput);
            await circuit.checkConstraints(witness);
        });
    });

    // ── owner_hash privacy tests ───────────────────────────────────────────────

    describe("owner_hash reveals only the hash, not the pubkey", () => {
        it("owner_hash is independent of value and asset_id", async () => {
            const hash1 = computeOwnerHash(OWNER_PUBKEY);

            // Different value, same owner_pubkey → same owner_hash
            const input2 = buildInput({ value: 9999n });
            const w2 = await circuit.calculateWitness(input2);
            await circuit.checkConstraints(w2);

            expect(w2[1].toString()).to.equal(hash1.toString());
        });

        it("different blinding values produce the same owner_hash", async () => {
            const w1 = await circuit.calculateWitness(buildInput({ blinding: 111n }));
            const w2 = await circuit.calculateWitness(buildInput({ blinding: 222n }));
            await circuit.checkConstraints(w1);
            await circuit.checkConstraints(w2);

            expect(w1[1].toString()).to.equal(w2[1].toString());
        });
    });
});
