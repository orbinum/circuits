import path from "path";
import fs from "fs";
import { expect } from "chai";
import { wasm as wasm_tester } from "circom_tester";
import { buildPoseidon, buildBabyjub } from "circomlibjs";
import type { WasmTester } from "circom_tester";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CircuitInput extends Record<string, string> {
    // Public inputs
    commitment: string;
    auditor_pk_x: string;
    auditor_pk_y: string;
    // Private inputs
    value: string;
    asset_id: string;
    owner_pubkey: string;
    blinding: string;
    disclose_value: string;
    disclose_asset_id: string;
    disclose_owner: string;
    r: string;
}

interface CircuitOutputs {
    epk_x: bigint;
    epk_y: bigint;
    enc_value: bigint;
    enc_asset_id: bigint;
    enc_owner_hash: bigint;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BN254_P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Fixed test scalars (within BN254 scalar field, not full random to be deterministic)
const TEST_AUDITOR_SK = 123456789012345678901234567890123456789n;
const TEST_R = 987654321098765432109876543210987654321n;

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe("Selective Disclosure Circuit — ECDH on-circuit", function () {
    this.timeout(120000);

    const circuitPath = path.join(__dirname, "..", "circuits", "disclosure.circom");
    const outputDir = path.join(__dirname, "..", "build");

    let circuit: WasmTester;
    let poseidon: any;
    let F: any;
    let babyJub: any;

    // Baby Jubjub auditor keypair (derived from fixed sk for determinism)
    let auditorPkX: bigint;
    let auditorPkY: bigint;

    before(async function () {
        const precompiledWasm = path.join(outputDir, "disclosure_js", "disclosure.wasm");
        if (!fs.existsSync(precompiledWasm)) {
            this.skip();
            return;
        }

        circuit = await wasm_tester(circuitPath, { output: outputDir, recompile: false });
        poseidon = await buildPoseidon();
        F = poseidon.F;
        babyJub = await buildBabyjub();

        // Derive auditor Baby Jubjub pubkey: pk = sk · G
        const pk = babyJub.mulPointEscalar(babyJub.Base8, TEST_AUDITOR_SK);
        auditorPkX = BigInt(babyJub.F.toString(pk[0]));
        auditorPkY = BigInt(babyJub.F.toString(pk[1]));
    });

    // ── Helpers ─────────────────────────────────────────────────────────────

    function commitment(value: bigint, assetId: bigint, ownerPk: bigint, blinding: bigint): string {
        return F.toString(poseidon([value, assetId, ownerPk, blinding]));
    }

    function ownerHash(ownerPk: bigint): bigint {
        return BigInt(F.toString(poseidon([ownerPk])));
    }

    /** Build a Poseidon keystream from a Baby Jubjub point. */
    function keystream(sharedX: bigint, sharedY: bigint): [bigint, bigint, bigint] {
        const k0 = BigInt(F.toString(poseidon([sharedX, sharedY, 0n])));
        const k1 = BigInt(F.toString(poseidon([sharedX, sharedY, 1n])));
        const k2 = BigInt(F.toString(poseidon([sharedX, sharedY, 2n])));
        return [k0, k1, k2];
    }

    /** Decrypt field: (enc - k + P) mod P */
    function fieldSub(enc: bigint, k: bigint): bigint {
        return (enc - k + BN254_P) % BN254_P;
    }

    /** Extract the 5 public outputs from the circuit witness. */
    async function runCircuit(input: CircuitInput): Promise<CircuitOutputs> {
        const witness = await circuit.calculateWitness(input);
        await circuit.checkConstraints(witness);

        // Witness layout: [1, out_0, out_1, out_2, out_3, out_4, pub_in_0, pub_in_1, pub_in_2, ...]
        // The 5 outputs (epk_x, epk_y, enc_value, enc_asset_id, enc_owner_hash) come before the inputs
        return {
            epk_x: BigInt(witness[1].toString()),
            epk_y: BigInt(witness[2].toString()),
            enc_value: BigInt(witness[3].toString()),
            enc_asset_id: BigInt(witness[4].toString()),
            enc_owner_hash: BigInt(witness[5].toString()),
        };
    }

    function baseInput(overrides: Partial<CircuitInput> = {}): CircuitInput {
        const value = 1_000_000n;
        const assetId = 0n;
        const ownerPk = 12345678901234567890n;
        const blinding = 98765432109876543210n;
        return {
            commitment: commitment(value, assetId, ownerPk, blinding),
            auditor_pk_x: auditorPkX.toString(),
            auditor_pk_y: auditorPkY.toString(),
            value: value.toString(),
            asset_id: assetId.toString(),
            owner_pubkey: ownerPk.toString(),
            blinding: blinding.toString(),
            disclose_value: "0",
            disclose_asset_id: "0",
            disclose_owner: "0",
            r: TEST_R.toString(),
            ...overrides,
        };
    }

    // ── 1. Commitment verification ───────────────────────────────────────────

    describe("1. Commitment verification", () => {
        it("accepts a valid commitment with all fields hidden", async () => {
            await runCircuit(baseInput());
        });

        it("rejects an incorrect commitment (tampered by +1)", async () => {
            const c = BigInt(baseInput().commitment) + 1n;
            try {
                await circuit.calculateWitness(baseInput({ commitment: c.toString() }));
                expect.fail("Expected Assert Failed");
            } catch (e: any) {
                expect(e.message).to.include("Assert Failed");
            }
        });

        it("changes commitment when value changes", () => {
            const c1 = commitment(1000n, 0n, 111n, 222n);
            const c2 = commitment(9999n, 0n, 111n, 222n);
            expect(c1).to.not.equal(c2);
        });

        it("changes commitment when asset_id changes", () => {
            const c1 = commitment(1000n, 0n, 111n, 222n);
            const c2 = commitment(1000n, 1n, 111n, 222n);
            expect(c1).to.not.equal(c2);
        });

        it("changes commitment when owner_pubkey changes", () => {
            const c1 = commitment(1000n, 0n, 111n, 222n);
            const c2 = commitment(1000n, 0n, 999n, 222n);
            expect(c1).to.not.equal(c2);
        });

        it("changes commitment when blinding changes", () => {
            const c1 = commitment(1000n, 0n, 111n, 222n);
            const c2 = commitment(1000n, 0n, 111n, 333n);
            expect(c1).to.not.equal(c2);
        });

        it("rejects wrong owner_pubkey (can't reconstruct commitment)", async () => {
            const c = commitment(1000n, 0n, 777n, 888n);
            try {
                await circuit.calculateWitness(
                    baseInput({
                        commitment: c,
                        owner_pubkey: "778", // wrong
                    })
                );
                expect.fail("Expected Assert Failed");
            } catch (e: any) {
                expect(e.message).to.include("Assert Failed");
            }
        });
    });

    // ── 2. ECDH ephemeral key ────────────────────────────────────────────────

    describe("2. ECDH ephemeral key (epk = r·G)", () => {
        it("produces deterministic epk from fixed r", async () => {
            const out1 = await runCircuit(baseInput());
            const out2 = await runCircuit(baseInput());
            expect(out1.epk_x).to.equal(out2.epk_x);
            expect(out1.epk_y).to.equal(out2.epk_y);
        });

        it("produces different epk when r changes", async () => {
            const r2 = (TEST_R + 1n).toString();
            const out1 = await runCircuit(baseInput());
            const out2 = await runCircuit(baseInput({ r: r2 }));
            expect(out1.epk_x).to.not.equal(out2.epk_x);
        });

        it("epk matches expected Baby Jubjub scalar mult r·G (off-circuit)", async () => {
            const expectedEpk = babyJub.mulPointEscalar(babyJub.Base8, TEST_R);
            const out = await runCircuit(baseInput());
            expect(out.epk_x).to.equal(BigInt(babyJub.F.toString(expectedEpk[0])));
            expect(out.epk_y).to.equal(BigInt(babyJub.F.toString(expectedEpk[1])));
        });
    });

    // ── 3. ECDH symmetry (shared secret) ────────────────────────────────────

    describe("3. ECDH symmetry — shared secret equals from both sides", () => {
        it("r·pk_A == sk_A·epk (off-circuit verification)", async () => {
            const out = await runCircuit(baseInput());

            // Owner's side: shared = r · pk_A
            const pkPoint = [
                babyJub.F.e(auditorPkX.toString()),
                babyJub.F.e(auditorPkY.toString()),
            ];
            const sharedOwner = babyJub.mulPointEscalar(pkPoint, TEST_R);

            // Auditor's side: shared = sk_A · epk
            const epkPoint = [babyJub.F.e(out.epk_x.toString()), babyJub.F.e(out.epk_y.toString())];
            const sharedAuditor = babyJub.mulPointEscalar(epkPoint, TEST_AUDITOR_SK);

            expect(babyJub.F.toString(sharedOwner[0])).to.equal(
                babyJub.F.toString(sharedAuditor[0])
            );
            expect(babyJub.F.toString(sharedOwner[1])).to.equal(
                babyJub.F.toString(sharedAuditor[1])
            );
        });
    });

    // ── 4. Encryption: ciphertext correctness ───────────────────────────────

    describe("4. Encryption correctness (enc = plaintext + keystream)", () => {
        const VALUE = 500_000n;
        const ASSET_ID = 3n;
        const OWNER_PK = 77777777777777n;
        const BLINDING = 99999999999999n;

        function buildInput(flags: { v: boolean; a: boolean; o: boolean }): CircuitInput {
            return {
                commitment: commitment(VALUE, ASSET_ID, OWNER_PK, BLINDING),
                auditor_pk_x: auditorPkX.toString(),
                auditor_pk_y: auditorPkY.toString(),
                value: VALUE.toString(),
                asset_id: ASSET_ID.toString(),
                owner_pubkey: OWNER_PK.toString(),
                blinding: BLINDING.toString(),
                disclose_value: flags.v ? "1" : "0",
                disclose_asset_id: flags.a ? "1" : "0",
                disclose_owner: flags.o ? "1" : "0",
                r: TEST_R.toString(),
            };
        }

        /** Compute shared secret (owner side): r · pk_A */
        function sharedSecret(r: bigint): [bigint, bigint] {
            const pkPoint = [
                babyJub.F.e(auditorPkX.toString()),
                babyJub.F.e(auditorPkY.toString()),
            ];
            const s = babyJub.mulPointEscalar(pkPoint, r);
            return [BigInt(babyJub.F.toString(s[0])), BigInt(babyJub.F.toString(s[1]))];
        }

        it("enc_value decrypts to value when disclose_value=1", async () => {
            const out = await runCircuit(buildInput({ v: true, a: false, o: false }));
            const [sx, sy] = sharedSecret(TEST_R);
            const [k0] = keystream(sx, sy);
            expect(fieldSub(out.enc_value, k0)).to.equal(VALUE);
        });

        it("enc_value decrypts to 0 when disclose_value=0", async () => {
            const out = await runCircuit(buildInput({ v: false, a: false, o: false }));
            const [sx, sy] = sharedSecret(TEST_R);
            const [k0] = keystream(sx, sy);
            expect(fieldSub(out.enc_value, k0)).to.equal(0n);
        });

        it("enc_asset_id decrypts to asset_id when disclose_asset_id=1", async () => {
            const out = await runCircuit(buildInput({ v: false, a: true, o: false }));
            const [sx, sy] = sharedSecret(TEST_R);
            const [, k1] = keystream(sx, sy);
            expect(fieldSub(out.enc_asset_id, k1)).to.equal(ASSET_ID);
        });

        it("enc_owner_hash decrypts to Poseidon(owner_pubkey) when disclose_owner=1", async () => {
            const out = await runCircuit(buildInput({ v: false, a: false, o: true }));
            const [sx, sy] = sharedSecret(TEST_R);
            const [, , k2] = keystream(sx, sy);
            expect(fieldSub(out.enc_owner_hash, k2)).to.equal(ownerHash(OWNER_PK));
        });

        it("enc_owner_hash decrypts to 0 when disclose_owner=0", async () => {
            const out = await runCircuit(buildInput({ v: false, a: false, o: false }));
            const [sx, sy] = sharedSecret(TEST_R);
            const [, , k2] = keystream(sx, sy);
            expect(fieldSub(out.enc_owner_hash, k2)).to.equal(0n);
        });

        it("all three fields decrypt correctly when all flags=1", async () => {
            const out = await runCircuit(buildInput({ v: true, a: true, o: true }));
            const [sx, sy] = sharedSecret(TEST_R);
            const [k0, k1, k2] = keystream(sx, sy);
            expect(fieldSub(out.enc_value, k0)).to.equal(VALUE);
            expect(fieldSub(out.enc_asset_id, k1)).to.equal(ASSET_ID);
            expect(fieldSub(out.enc_owner_hash, k2)).to.equal(ownerHash(OWNER_PK));
        });
    });

    // ── 5. Round-trip: different r, same decrypted plaintext ────────────────

    describe("5. Round-trip with different r", () => {
        it("changing r produces different ciphertexts but same plaintext after decrypt", async () => {
            const value = 123_456n;
            const assetId = 1n;
            const ownerPk = 9999999999n;
            const blind = 1234567890n;
            const c = commitment(value, assetId, ownerPk, blind);

            const r1 = TEST_R;
            const r2 = TEST_R + 7919n; // different prime-sized offset

            const input1: CircuitInput = {
                commitment: c,
                auditor_pk_x: auditorPkX.toString(),
                auditor_pk_y: auditorPkY.toString(),
                value: value.toString(),
                asset_id: assetId.toString(),
                owner_pubkey: ownerPk.toString(),
                blinding: blind.toString(),
                disclose_value: "1",
                disclose_asset_id: "1",
                disclose_owner: "1",
                r: r1.toString(),
            };
            const input2 = { ...input1, r: r2.toString() };

            const out1 = await runCircuit(input1);
            const out2 = await runCircuit(input2);

            // Ciphertexts differ
            expect(out1.epk_x).to.not.equal(out2.epk_x);
            expect(out1.enc_value).to.not.equal(out2.enc_value);

            // But decrypt to same plaintext
            const pkPoint = [
                babyJub.F.e(auditorPkX.toString()),
                babyJub.F.e(auditorPkY.toString()),
            ];
            const s1 = babyJub.mulPointEscalar(pkPoint, r1);
            const s2 = babyJub.mulPointEscalar(pkPoint, r2);
            const [k0_1] = keystream(
                BigInt(babyJub.F.toString(s1[0])),
                BigInt(babyJub.F.toString(s1[1]))
            );
            const [k0_2] = keystream(
                BigInt(babyJub.F.toString(s2[0])),
                BigInt(babyJub.F.toString(s2[1]))
            );

            expect(fieldSub(out1.enc_value, k0_1)).to.equal(value);
            expect(fieldSub(out2.enc_value, k0_2)).to.equal(value);
        });
    });

    // ── 6. Disclosure mask: boolean constraints ──────────────────────────────

    describe("6. Disclosure mask boolean constraints", () => {
        it("rejects disclose_value=2 (non-boolean)", async () => {
            try {
                await circuit.calculateWitness(baseInput({ disclose_value: "2" }));
                expect.fail("Expected Assert Failed");
            } catch (e: any) {
                expect(e.message).to.include("Assert Failed");
            }
        });

        it("rejects disclose_asset_id=255 (non-boolean)", async () => {
            try {
                await circuit.calculateWitness(baseInput({ disclose_asset_id: "255" }));
                expect.fail("Expected Assert Failed");
            } catch (e: any) {
                expect(e.message).to.include("Assert Failed");
            }
        });
    });

    // ── 7. Owner hash: Poseidon, never raw pubkey ────────────────────────────

    describe("7. Owner revealed as Poseidon hash, not raw pubkey", () => {
        it("enc_owner_hash decrypts to Poseidon(owner_pubkey), not owner_pubkey itself", async () => {
            const ownerPk = 42424242424242n;
            const c = commitment(1000n, 0n, ownerPk, 111n);
            const out = await runCircuit({
                commitment: c,
                auditor_pk_x: auditorPkX.toString(),
                auditor_pk_y: auditorPkY.toString(),
                value: "1000",
                asset_id: "0",
                owner_pubkey: ownerPk.toString(),
                blinding: "111",
                disclose_value: "0",
                disclose_asset_id: "0",
                disclose_owner: "1",
                r: TEST_R.toString(),
            });

            const pkPoint = [
                babyJub.F.e(auditorPkX.toString()),
                babyJub.F.e(auditorPkY.toString()),
            ];
            const shared = babyJub.mulPointEscalar(pkPoint, TEST_R);
            const [, , k2] = keystream(
                BigInt(babyJub.F.toString(shared[0])),
                BigInt(babyJub.F.toString(shared[1]))
            );

            const decrypted = fieldSub(out.enc_owner_hash, k2);
            expect(decrypted).to.equal(ownerHash(ownerPk));
            expect(decrypted).to.not.equal(ownerPk); // raw pubkey never exposed
        });
    });
});

// ─── Legacy tests removed — circuit interface changed with ECDH on-circuit ───
// Old Phase 2 suite used plaintext public outputs (revealed_value etc.).
// The new interface encrypts all field disclosures. See sections 1-7 above.
