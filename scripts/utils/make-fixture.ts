/**
 * Emits a deterministic circuit fixture: `input.json`, `<circuit>.wtns`, and the
 * witness as decimal strings.
 *
 * These exist so a prover outside this repo — the native Rust one, a mobile
 * FFI — can be measured and differential-tested against snarkjs without
 * reimplementing note construction first. Nothing in `circuits/` or
 * `groth16-proofs/` ships a `.wtns`, and `bench-groth16` cannot run without one.
 *
 * The inputs mirror each circuit's `test/*.test.ts` `buildInput()` with its
 * hardcoded defaults, so a fixture is reproducible from nothing but this file:
 * same spending key, same blindings, same leaf index, every run. That is what
 * makes it usable as a golden vector — a fixture with a random blinding would
 * prove a different statement each time it was regenerated.
 *
 * # The public-signal order
 *
 * Each circuit's entry in `PUBLIC_SIGNALS` is the layout a verifier must use,
 * and it is not always the `public [...]` list read left to right:
 *
 *   - `transfer` declares five names, two of which are arrays of two, so the
 *     seven signals are `merkle_root, nullifiers[0], nullifiers[1],
 *     commitments[0], commitments[1], asset_id, fee`.
 *   - `value_proof` declares three names but has four signals, because Circom
 *     places a template's `signal output` ahead of its public inputs in the
 *     witness. `owner_hash` is an output.
 *
 * Both are asserted below against the real witness rather than trusted, which
 * is the only way to know rather than believe.
 *
 * Usage:
 *   pnpm exec ts-node scripts/utils/make-fixture.ts [circuit] [outDir]
 *
 * Defaults to the `unshield` circuit into `fixtures/`.
 */
import fs from "fs";
import path from "path";
import {
    SIGNAL_LAYOUT,
    parseCircuit,
    signalName,
    signalValue,
    type CircuitName,
} from "../lib/circuits";
import { die, info, ok } from "../lib/log";
import { NoteCrypto, TREE_DEPTH } from "../lib/note";
import { artifacts, fixtures, rel } from "../lib/paths";
const snarkjs = require("snarkjs");

/**
 * A public signal: either a plain input name, or one element of an array input,
 * or a circuit output that has no corresponding input at all.
 */

/**
 * The defaults from `test/unshield.test.ts`. Reproduced rather than imported
 * because they live inside a `describe()` closure there.
 */
const DEFAULTS = {
    noteValue: 1000n,
    amount: 1000n,
    fee: 0n,
    changeValue: 0n,
    assetId: 0n,
    blinding: 0xfedcba0987654321n,
    spendingKey: 0xdeadbeefcafebaben,
    recipient: 0xaabbccddee112233n,
    changeBlinding: 0xabcdef1234567890n,
    leafIndex: 0,
};

async function buildUnshieldInput(): Promise<Built> {
    const note = await NoteCrypto.build();
    const d = DEFAULTS;

    const owner = note.ownerPubkey(d.spendingKey);
    const commitment = note.commitment(d.noteValue, d.assetId, owner, d.blinding);
    const nullifier = note.nullifier(commitment, d.spendingKey);

    const { root, pathElements, pathIndices } = note.singleLeafTree(commitment, d.leafIndex);

    // change_commitment is 0 for a total unshield — constraint 8b requires it.
    const changeCommitment =
        d.changeValue > 0n
            ? note.commitment(d.changeValue, d.assetId, owner, d.changeBlinding)
            : 0n;

    return {
        input: {
            // public
            merkle_root: root.toString(),
            nullifier: nullifier.toString(),
            amount: d.amount.toString(),
            recipient: d.recipient.toString(),
            asset_id: d.assetId.toString(),
            fee: d.fee.toString(),
            change_commitment: changeCommitment.toString(),
            // private
            note_value: d.noteValue.toString(),
            // Supplied even though --O1 eliminated it (varIdx -1 in unshield.sym): the
            // witness calculator still requires every declared input signal, it just
            // occupies no slot in the resulting vector.
            note_asset_id: d.assetId.toString(),
            note_blinding: d.blinding.toString(),
            spending_key: d.spendingKey.toString(),
            change_value: d.changeValue.toString(),
            change_blinding: d.changeBlinding.toString(),
            change_owner_pubkey: owner.toString(),
            path_elements: pathElements.map((e) => e.toString()),
            path_indices: pathIndices,
        },
    };
}

/** What a builder returns: the circuit input, plus any public outputs it has. */
type Built = {
    input: Record<string, unknown>;
    /** Expected values of `signal output`s that are public signals. */
    outputs?: Record<string, bigint>;
};

/**
 * The defaults from `test/transfer.test.ts`, reproduced here for the same
 * reason as the unshield ones: they live inside a `describe()` closure there.
 *
 * One real input note and one dummy (value 0), which the circuit explicitly
 * supports — it skips the Merkle and nullifier checks for a zero-valued input
 * and forces its nullifier to zero. That keeps the fixture to a single Merkle
 * path while still exercising both slots.
 */
const TRANSFER_DEFAULTS = {
    inputValue: 1_000n,
    assetId: 0n,
    fee: 10n,
    blinding: 0x1122334455667788n,
    spendingKey: 0xdeadbeefcafebaben,
    outputBlindings: [0xaabbccdd11223344n, 0x5566778899aabbccn],
    outputOwners: [0x1111111111111111n, 0x2222222222222222n],
    leafIndex: 0,
};

/** The defaults from `test/value_proof.test.ts`. */
const VALUE_PROOF_DEFAULTS = {
    ownerPubkey: 0xdeadbeef_cafebabe_12345678_90abcdefn,
    blinding: 0xfedcba09_87654321_aabbccdd_eeff0011n,
    value: 1_000n,
    assetId: 0n,
};

async function buildTransferInput(): Promise<Built> {
    const note = await NoteCrypto.build();
    const d = TRANSFER_DEFAULTS;

    // Slot 0 is a real note; slot 1 is a dummy (value 0).
    const owner = note.ownerPubkey(d.spendingKey);
    const inputCommitment = note.commitment(d.inputValue, d.assetId, owner, d.blinding);
    const nullifier = note.nullifier(inputCommitment, d.spendingKey);

    const { root, pathElements, pathIndices } = note.singleLeafTree(inputCommitment, d.leafIndex);

    // Constraint 5: sum(inputs) == sum(outputs) + fee.
    const outputValues = [d.inputValue - d.fee, 0n];
    const commitments = [0, 1].map((i) =>
        note.commitment(outputValues[i], d.assetId, d.outputOwners[i], d.outputBlindings[i])
    );

    // A dummy input's nullifier is forced to zero by the circuit.
    const zeroPath = Array(TREE_DEPTH).fill("0");

    return {
        input: {
            // public
            merkle_root: root.toString(),
            nullifiers: [nullifier.toString(), "0"],
            commitments: commitments.map(String),
            asset_id: d.assetId.toString(),
            fee: d.fee.toString(),
            // private — input notes
            input_values: [d.inputValue.toString(), "0"],
            input_asset_ids: [d.assetId.toString(), d.assetId.toString()],
            input_blindings: [d.blinding.toString(), "0"],
            spending_keys: [d.spendingKey.toString(), d.spendingKey.toString()],
            input_path_elements: [pathElements.map(String), zeroPath],
            input_path_indices: [pathIndices.map(String), zeroPath],
            // private — output notes
            output_values: outputValues.map(String),
            output_asset_ids: [d.assetId.toString(), d.assetId.toString()],
            output_owner_pubkeys: d.outputOwners.map(String),
            output_blindings: d.outputBlindings.map(String),
        },
    };
}

async function buildValueProofInput(): Promise<Built> {
    const note = await NoteCrypto.build();
    const d = VALUE_PROOF_DEFAULTS;

    const commitment = note.commitment(d.value, d.assetId, d.ownerPubkey, d.blinding);
    const ownerHash = note.ownerHash(d.ownerPubkey);

    return {
        input: {
            // public
            commitment: commitment.toString(),
            value: d.value.toString(),
            asset_id: d.assetId.toString(),
            // private
            owner_pubkey: d.ownerPubkey.toString(),
            blinding: d.blinding.toString(),
        },
        // `owner_hash` is a public signal but not an input, so its expected
        // value has to come from here for the layout assertion to check it.
        outputs: { owner_hash: ownerHash },
    };
}

const BUILDERS: Record<string, () => Promise<Built>> = {
    unshield: buildUnshieldInput,
    transfer: buildTransferInput,
    value_proof: buildValueProofInput,
};

async function main() {
    const circuit: CircuitName = parseCircuit(process.argv[2] ?? "unshield");

    const build = BUILDERS[circuit];
    if (!build) {
        die(`no fixture builder for "${circuit}"`);
    }

    const wasmPath = artifacts(circuit).wasm;
    if (!fs.existsSync(wasmPath)) {
        die(`circuit wasm not found: ${rel(wasmPath)}. Run 'pnpm run compile ${circuit}' first.`);
    }

    const { input: inputPath, wtns: wtnsPath, witnessJson: decimalPath } = fixtures(circuit);
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });

    const signals = SIGNAL_LAYOUT[circuit];

    console.log(`Building ${circuit} input…`);
    const { input, outputs = {} } = await build();
    fs.writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);

    console.log("Calculating witness…");
    const wtns = { type: "mem" } as { type: string; data?: Uint8Array };
    await snarkjs.wtns.calculate(input, fs.readFileSync(wasmPath), wtns);
    fs.writeFileSync(wtnsPath, Buffer.from(wtns.data!));

    const witness: bigint[] = await snarkjs.wtns.exportJson(wtns);
    fs.writeFileSync(
        decimalPath,
        `${JSON.stringify(
            { num_public_signals: signals.length, witness: witness.map(String) },
            null,
            2
        )}\n`
    );

    // The witness layout is an unchecked contract with the proving key. Assert it
    // here, where a mismatch is one confusing line, rather than downstream where
    // it surfaces as a proof that verifies against nothing.
    //
    // This is also where the layouts in PUBLIC_SIGNALS stop being a claim: for
    // value_proof in particular, it is the only evidence of whether Circom puts
    // the `owner_hash` output before the public inputs or after them.
    if (witness[0] !== 1n) {
        throw new Error(`witness[0] is ${witness[0]}, expected the constant 1`);
    }
    for (const [i, signal] of signals.entries()) {
        const expected = signalValue(signal, input, outputs);
        if (witness[i + 1] !== expected) {
            throw new Error(
                `witness[${i + 1}] (${signalName(signal)}) is ${witness[i + 1]}, expected ` +
                    `${expected} — the public signal order does not match the circuit's ` +
                    `public [...] list`
            );
        }
    }

    info("");
    ok(rel(inputPath));
    ok(`${rel(wtnsPath)} (${fs.statSync(wtnsPath).size} bytes)`);
    ok(rel(decimalPath));
    info("");
    info(`  witness elements:   ${witness.length}`);
    info(`  public signals:     ${signals.length}`);
    info(`  witness[0]:         ${witness[0]} (constant)`);
    info(`  witness[1..${signals.length}]:      verified — ${signals.map(signalName).join(", ")}`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
        process.exit(1);
    });
