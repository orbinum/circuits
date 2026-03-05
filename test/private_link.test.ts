/**
 * private_link.test.ts
 * ====================
 * Tests for the PrivateLinkDispatch Circom circuit
 * (circuits/private_link.circom).
 *
 * Test sections:
 *   1. Poseidon commitment scheme  — pure in-process math, no circuit needed.
 *   2. Circuit constraints         — uses wasm_tester to verify R1CS hold / fail.
 *
 * Run with: npm test
 *
 * Commitment scheme (must match Rust pallet):
 *   inner      = Poseidon2(chain_id_fe, address_fe)
 *   commitment = Poseidon2(inner,       blinding_fe)
 *
 * Encoding (mirroring Fr::from_le_bytes_mod_order in Rust):
 *   chain_id_fe : BigInt(chain_id)           — value ≤ 2^32 < p
 *   address_fe  : address bytes zero-padded RIGHT to 32 bytes, LE integer mod p
 *   blinding_fe : 32-byte scalar, LE integer mod p
 *   call_hash_fe: blake2_256 output, LE integer mod p
 */

import path from "path";
import { wasm as wasm_tester } from "circom_tester";
import { buildPoseidon } from "circomlibjs";
import { expect } from "chai";
import type { WasmTester } from "circom_tester";
import { cleanupTestCircuits } from "./test-utils";

// ── BN254 scalar field order ──────────────────────────────────────────────────
const FIELD_ORDER = BigInt(
    "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

// ── Encoding helpers ──────────────────────────────────────────────────────────

/**
 * Convert a byte array (interpreted as little-endian) to a BN254 field element.
 * Zero-pads (or truncates) to `length` bytes before conversion.
 * Mirrors `Fr::from_le_bytes_mod_order` in Rust.
 */
function leBytesToFe(bytes: Uint8Array | Buffer, length = 32): bigint {
    const buf = new Uint8Array(length);
    buf.set(Array.from(bytes).slice(0, length));
    let value = 0n;
    for (let i = 0; i < length; i++) {
        value += BigInt(buf[i]) * 256n ** BigInt(i);
    }
    return value % FIELD_ORDER;
}

/**
 * Convert a 32-bit chain ID to a BN254 field element.
 * Equivalent to Fr::from(chain_id as u64) in Rust (4-byte LE, zero-padded).
 */
function chainIdToFe(chainId: number): bigint {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(chainId, 0);
    return leBytesToFe(buf, 32);
}

/**
 * Compute the Poseidon private-link commitment, matching the on-chain scheme.
 *
 *   inner      = Poseidon2(chain_id_fe, address_fe)
 *   commitment = Poseidon2(inner,       blinding_fe)
 */
function computeCommitment(
    poseidon: any,
    chainId: number,
    address: Buffer,
    blinding: Buffer
): bigint {
    const chain_id_fe = chainIdToFe(chainId);
    const address_fe = leBytesToFe(address);
    const blinding_fe = leBytesToFe(blinding);

    const inner = poseidon.F.toObject(poseidon([chain_id_fe, address_fe]));
    return poseidon.F.toObject(poseidon([inner, blinding_fe]));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAIN_ID = 1; // Ethereum mainnet
const ADDRESS = Buffer.from("aB5801a7D398351b8bE11C439e05C5B3259aeC9B", "hex"); // 20 B
const BLINDING = Buffer.alloc(32, 0x42); // deterministic test blinding
const CALL_HASH = Buffer.alloc(32, 0xde); // mock blake2_256 output

// ══════════════════════════════════════════════════════════════════════════════
// 1. Commitment scheme — pure TS/JS Poseidon math
// ══════════════════════════════════════════════════════════════════════════════

describe("PrivateLink – Poseidon commitment scheme", function () {
    this.timeout(60_000);

    let poseidon: any;

    before(async () => {
        poseidon = await buildPoseidon();
    });

    it("produces a non-zero commitment for valid inputs", () => {
        const c = computeCommitment(poseidon, CHAIN_ID, ADDRESS, BLINDING);
        expect(c).to.not.equal(0n);
    });

    it("is deterministic — same inputs always produce the same commitment", () => {
        const c1 = computeCommitment(poseidon, CHAIN_ID, ADDRESS, BLINDING);
        const c2 = computeCommitment(poseidon, CHAIN_ID, ADDRESS, BLINDING);
        expect(c1.toString()).to.equal(c2.toString());
    });

    it("different blinding → different commitment", () => {
        const b1 = Buffer.alloc(32, 0x01);
        const b2 = Buffer.alloc(32, 0x02);
        expect(computeCommitment(poseidon, CHAIN_ID, ADDRESS, b1).toString()).to.not.equal(
            computeCommitment(poseidon, CHAIN_ID, ADDRESS, b2).toString()
        );
    });

    it("different address → different commitment", () => {
        const a1 = Buffer.alloc(20, 0x01);
        const a2 = Buffer.alloc(20, 0x02);
        expect(computeCommitment(poseidon, CHAIN_ID, a1, BLINDING).toString()).to.not.equal(
            computeCommitment(poseidon, CHAIN_ID, a2, BLINDING).toString()
        );
    });

    it("different chain_id → different commitment", () => {
        const c_eth = computeCommitment(poseidon, 1, ADDRESS, BLINDING);
        const c_bsc = computeCommitment(poseidon, 56, ADDRESS, BLINDING);
        expect(c_eth.toString()).to.not.equal(c_bsc.toString());
    });

    it("address > 32 bytes gets truncated to 32 bytes (same as Rust copy_len.min(32))", () => {
        // Base: 20-byte address
        const addr20 = Buffer.alloc(20, 0xab);
        // Padded to 32 bytes on the right with zeros (as Rust does)
        const addr32 = Buffer.alloc(32, 0x00);
        addr20.copy(addr32, 0);
        expect(computeCommitment(poseidon, CHAIN_ID, addr20, BLINDING).toString()).to.equal(
            computeCommitment(poseidon, CHAIN_ID, addr32, BLINDING).toString()
        );
    });

    it("commitment output matches circomlibjs Poseidon(2) directly", () => {
        const chain_id_fe = chainIdToFe(CHAIN_ID);
        const address_fe = leBytesToFe(ADDRESS);
        const blinding_fe = leBytesToFe(BLINDING);

        const inner = poseidon.F.toObject(poseidon([chain_id_fe, address_fe]));
        const expected = poseidon.F.toObject(poseidon([inner, blinding_fe]));
        const actual = computeCommitment(poseidon, CHAIN_ID, ADDRESS, BLINDING);

        expect(actual.toString()).to.equal(expected.toString());
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Circuit constraints — wasm_tester (R1CS witness generation)
// ══════════════════════════════════════════════════════════════════════════════

describe("PrivateLinkDispatch circuit – constraint verification", function () {
    this.timeout(120_000);

    let poseidon: any;
    let circuit: WasmTester;

    before(async function () {
        poseidon = await buildPoseidon();

        circuit = await wasm_tester(path.join(__dirname, "..", "circuits", "private_link.circom"), {
            output: path.join(__dirname, "..", "build"),
            recompile: true,
        });
    });

    after(async function () {
        // Remove temp artifacts generated by wasm_tester
        cleanupTestCircuits(["private_link"]);
    });

    // ── Helper: build witness input ─────────────────────────────────────────
    function buildInput(
        chainId: number,
        address: Buffer,
        blinding: Buffer,
        callHash: Buffer,
        overrideCommitment?: bigint
    ) {
        const commitment =
            overrideCommitment ?? computeCommitment(poseidon, chainId, address, blinding);
        return {
            commitment: commitment.toString(),
            call_hash_fe: leBytesToFe(callHash).toString(),
            chain_id_fe: chainIdToFe(chainId).toString(),
            address_fe: leBytesToFe(address).toString(),
            blinding_fe: leBytesToFe(blinding).toString(),
        };
    }

    // ── 2a. Happy path ──────────────────────────────────────────────────────

    it("accepts a valid witness for correct inputs", async () => {
        const input = buildInput(CHAIN_ID, ADDRESS, BLINDING, CALL_HASH);
        const witness = await circuit.calculateWitness(input, true);
        await circuit.checkConstraints(witness);
    });

    it("public signal[0] equals the computed commitment", async () => {
        const expected = computeCommitment(poseidon, CHAIN_ID, ADDRESS, BLINDING);
        const input = buildInput(CHAIN_ID, ADDRESS, BLINDING, CALL_HASH);
        const witness = await circuit.calculateWitness(input, true);
        // witness[1] → first public output after the constant term
        expect(witness[1].toString()).to.equal(expected.toString());
    });

    it("public signal[2] equals call_hash_fe", async () => {
        const expected = leBytesToFe(CALL_HASH);
        const input = buildInput(CHAIN_ID, ADDRESS, BLINDING, CALL_HASH);
        const witness = await circuit.calculateWitness(input, true);
        // witness layout: [0]=1 (constant), [1]=commitment (public), [2]=call_hash_fe (public),
        // then intermediate signals (call_hash_sq, h1.out, h2.out, ...).
        expect(witness[2].toString()).to.equal(expected.toString());
    });

    it("different call_hash_fe inputs produce different witnesses", async () => {
        const callHashA = Buffer.alloc(32, 0xaa);
        const callHashB = Buffer.alloc(32, 0xbb);

        const wA = await circuit.calculateWitness(
            buildInput(CHAIN_ID, ADDRESS, BLINDING, callHashA),
            true
        );
        const wB = await circuit.calculateWitness(
            buildInput(CHAIN_ID, ADDRESS, BLINDING, callHashB),
            true
        );

        // Commitment signals (wA[1] / wB[1]) should be equal (same preimage)
        expect(wA[1].toString()).to.equal(wB[1].toString());
        // call_hash_fe signals (wA[2] / wB[2]) should differ
        expect(wA[2].toString()).to.not.equal(wB[2].toString());
    });

    it("call_hash_sq intermediate signal equals call_hash_fe squared (quadratic constraint active)", async () => {
        // This test verifies that the quadratic constraint `call_hash_sq <== call_hash_fe * call_hash_fe`
        // is satisfied in the witness. Because it is quadratic, --O1 cannot eliminate it from the R1CS,
        // guaranteeing that call_hash_fe's polynomial in the QAP (gamma_abc) is non-zero, which in turn
        // means Groth16 actually binds the proof to the submitted call_hash_fe value at verification time.
        //
        // NOTE: wasm_tester only verifies R1CS constraint satisfaction, not Groth16 proof-level binding.
        // To fully validate replay protection (that a proof for call_hash_A fails verification with
        // call_hash_B), run `npm run full-build:private-link` to generate keys, then use snarkjs
        // fullProve + verify with tampered publicSignals.
        const call_hash_fe = leBytesToFe(CALL_HASH);
        const expected_sq = (call_hash_fe * call_hash_fe) % FIELD_ORDER;

        const input = buildInput(CHAIN_ID, ADDRESS, BLINDING, CALL_HASH);
        const witness = await circuit.calculateWitness(input, true);
        await circuit.checkConstraints(witness);

        // Find call_hash_sq in the witness.
        // Public signals occupy witness[1..2]. Intermediate signals follow.
        // call_hash_sq is the first intermediate signal allocated in the template
        // (before h1 and h2 components' internals). Its exact index may vary
        // with circom version; we search for it by value.
        const sq_value = expected_sq.toString();
        const found = Array.from(witness).some((w: any) => w.toString() === sq_value);
        expect(found).to.be.true;
    });

    // ── 2b. Constraint violations ───────────────────────────────────────────

    it("rejects witness with wrong blinding (commitment mismatch)", async () => {
        const wrongBlinding = Buffer.alloc(32, 0xff);
        // Provide the *real* commitment but wrong blinding_fe → h2.out ≠ commitment
        const realCommitment = computeCommitment(poseidon, CHAIN_ID, ADDRESS, BLINDING);
        const input = buildInput(CHAIN_ID, ADDRESS, wrongBlinding, CALL_HASH, realCommitment);

        let threw = false;
        try {
            await circuit.calculateWitness(input, true);
        } catch {
            threw = true;
        }
        expect(threw).to.be.true;
    });

    it("rejects witness with wrong chain_id (commitment mismatch)", async () => {
        const realCommitment = computeCommitment(poseidon, CHAIN_ID, ADDRESS, BLINDING);
        const input = buildInput(9999, ADDRESS, BLINDING, CALL_HASH, realCommitment);

        let threw = false;
        try {
            await circuit.calculateWitness(input, true);
        } catch {
            threw = true;
        }
        expect(threw).to.be.true;
    });

    it("rejects witness with wrong address (commitment mismatch)", async () => {
        const wrongAddress = Buffer.alloc(20, 0xbe);
        const realCommitment = computeCommitment(poseidon, CHAIN_ID, ADDRESS, BLINDING);
        const input = buildInput(CHAIN_ID, wrongAddress, BLINDING, CALL_HASH, realCommitment);

        let threw = false;
        try {
            await circuit.calculateWitness(input, true);
        } catch {
            threw = true;
        }
        expect(threw).to.be.true;
    });
});
