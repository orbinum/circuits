import fs from "fs";
import path from "path";
import { expect } from "chai";
import { wasm as wasm_tester } from "circom_tester";
import type { WasmTester } from "circom_tester";
import { needCircuit, requireArtifact } from "./helpers/artifacts";
import { describeFreedom, scanFreedom } from "./helpers/freedom";
import { NoteCrypto } from "../scripts/lib/note";
import { sourceArtifacts } from "../scripts/lib/paths";

// Mirrored by `scripts/utils/make-fixture.ts`, so the fixture proves this statement.
const VALUE = 1000n;
const ASSET_ID = 0n;
const SPENDING_KEY = 0xdeadbeefcafebaben;
const BLINDING = 0xfedcba0987654321n;
const U128_MAX = (1n << 128n) - 1n;

interface BuildInputOpts {
    /** The note's value, i.e. what the commitment encodes. */
    noteValue?: bigint;
    noteAssetId?: bigint;
    /** The public `value` the pallet supplies; defaults to `noteValue`. */
    value?: bigint;
    /** The public `asset_id` the pallet supplies; defaults to `noteAssetId`. */
    assetId?: bigint;
    owner?: bigint;
    blinding?: bigint;
    /** Private owner/blinding given to the prover; default to the ones committed to. */
    witnessOwner?: bigint;
    witnessBlinding?: bigint;
}

describe("Shield Circuit", function () {
    this.timeout(120_000);

    const circuitPath = path.join(__dirname, "..", "circuits", "shield.circom");
    // Its own directory: recompiling into build/ would overwrite the published artifacts.
    const outputDir = path.join(__dirname, "..", "build", "test-circuits");
    const precompiledWasm = sourceArtifacts("shield").wasm;

    let circuitOrUndefined: WasmTester | undefined;
    let note: NoteCrypto;
    let owner: bigint;

    before(async function () {
        note = await NoteCrypto.build();
        owner = note.ownerPubkey(SPENDING_KEY);
        if (!requireArtifact(precompiledWasm, "shield")) return;
        fs.mkdirSync(outputDir, { recursive: true });
        circuitOrUndefined = await wasm_tester(circuitPath, { output: outputDir, recompile: true });
    });

    /** A commitment to `noteValue`/`noteAssetId`, checked against the public `value`/`assetId`. */
    function buildInput(opts: BuildInputOpts = {}) {
        const noteValue = opts.noteValue ?? VALUE;
        const noteAssetId = opts.noteAssetId ?? ASSET_ID;
        const noteOwner = opts.owner ?? owner;
        const noteBlinding = opts.blinding ?? BLINDING;
        return {
            commitment: note.commitment(noteValue, noteAssetId, noteOwner, noteBlinding).toString(),
            value: (opts.value ?? noteValue).toString(),
            asset_id: (opts.assetId ?? noteAssetId).toString(),
            owner_pubkey: (opts.witnessOwner ?? noteOwner).toString(),
            blinding: (opts.witnessBlinding ?? noteBlinding).toString(),
        };
    }

    async function rejects(circuit: WasmTester, input: ReturnType<typeof buildInput>) {
        try {
            await circuit.calculateWitness(input);
            expect.fail("the witness should not satisfy the constraints");
        } catch (err: any) {
            expect(err.message).to.include("Assert Failed");
        }
    }

    describe("accepts", () => {
        it("a commitment to exactly the deposited value and asset", async function () {
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            const w = await circuit.calculateWitness(buildInput());
            await circuit.checkConstraints(w);
        });

        it("emits commitment, value, asset_id as public signals, in that order", async function () {
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            const input = buildInput();
            const w = await circuit.calculateWitness(input);
            expect(w.slice(1, 4).map(String)).to.deep.equal([
                input.commitment,
                input.value,
                input.asset_id,
            ]);
        });

        it("the full u128 range, which the pallet's amount spans", async function () {
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            const w = await circuit.calculateWitness(buildInput({ noteValue: U128_MAX }));
            await circuit.checkConstraints(w);
        });

        it("a non-native asset", async function () {
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            const w = await circuit.calculateWitness(buildInput({ noteAssetId: 5n }));
            await circuit.checkConstraints(w);
        });
    });

    describe("binds", () => {
        it("every private input: owner and blinding cannot change under a fixed commitment", async function () {
            this.timeout(300_000);
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            const free = await scanFreedom(circuit, buildInput(), [
                "commitment",
                "value",
                "asset_id",
            ]);
            expect(describeFreedom(free)).to.equal("");
        });
    });

    // The circuit only ties the commitment to the deposit; the pallet bounds the
    // deposit itself (non-zero amount, registered asset). These are documented
    // acceptances, not findings.
    describe("leaves to the pallet", () => {
        it("a zero-valued or zero-owner note, and an asset id past u32", async function () {
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            for (const opts of [
                { noteValue: 0n },
                { owner: 0n },
                { blinding: 0n },
                { noteAssetId: 1n << 32n },
            ]) {
                const w = await circuit.calculateWitness(buildInput(opts));
                await circuit.checkConstraints(w);
            }
        });
    });

    describe("rejects", () => {
        it("a note worth more than the deposit (1000 committed, 1 deposited)", async function () {
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            await rejects(circuit, buildInput({ noteValue: 1000n, value: 1n }));
        });

        it("a note worth less than the deposit", async function () {
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            await rejects(circuit, buildInput({ noteValue: 1n, value: 1000n }));
        });

        it("a note in a different asset than the deposit", async function () {
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            await rejects(circuit, buildInput({ noteAssetId: 5n, assetId: 0n }));
        });

        it("a witness with a different owner than the one committed to", async function () {
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            await rejects(circuit, buildInput({ witnessOwner: owner + 1n }));
        });

        it("a witness with a different blinding than the one committed to", async function () {
            const circuit = needCircuit(circuitOrUndefined, "shield", this);
            await rejects(circuit, buildInput({ witnessBlinding: BLINDING + 1n }));
        });
    });
});
