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
import { buildPoseidon, buildBabyjub } from "circomlibjs";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs = require("snarkjs");

const ROOT = path.resolve(__dirname, "..", "..");

/** Matches `Unshield(20)` in circuits/unshield.circom. */
const TREE_DEPTH = 20;

/**
 * A public signal: either a plain input name, or one element of an array input,
 * or a circuit output that has no corresponding input at all.
 */
type Signal =
    | { kind: "input"; name: string }
    | { kind: "element"; name: string; index: number }
    | { kind: "output"; name: string };

const input = (name: string): Signal => ({ kind: "input", name });
const element = (name: string, index: number): Signal => ({ kind: "element", name, index });
const output = (name: string): Signal => ({ kind: "output", name });

/**
 * The public-signal layout of each circuit, in witness order.
 *
 * The order is load-bearing: the witness carries public signals at indices
 * 1..=n in exactly this sequence, and a prover that assumes a different one
 * produces a proof that fails verification with no error to explain it.
 */
const PUBLIC_SIGNALS: Record<string, readonly Signal[]> = {
    unshield: [
        input("merkle_root"),
        input("nullifier"),
        input("amount"),
        input("recipient"),
        input("asset_id"),
        input("fee"),
        input("change_commitment"),
    ],
    transfer: [
        input("merkle_root"),
        element("nullifiers", 0),
        element("nullifiers", 1),
        element("commitments", 0),
        element("commitments", 1),
        input("asset_id"),
        input("fee"),
    ],
    // `owner_hash` is a `signal output`, and Circom places outputs before
    // public inputs in the witness. Asserted against the real witness below,
    // because the circuit's own header comment lists it last.
    value_proof: [output("owner_hash"), input("commitment"), input("value"), input("asset_id")],
};

/** The value a signal should hold, given the circuit input it was built from. */
function signalValue(
    signal: Signal,
    input: Record<string, unknown>,
    outputs: Record<string, bigint>
): bigint {
    switch (signal.kind) {
        case "input":
            return BigInt(input[signal.name] as string);
        case "element":
            return BigInt((input[signal.name] as string[])[signal.index]);
        case "output": {
            const v = outputs[signal.name];
            if (v === undefined) {
                throw new Error(
                    `builder did not report the expected value of output "${signal.name}"`
                );
            }
            return v;
        }
    }
}

/** A human-readable name for a signal, for assertion messages. */
function signalName(s: Signal): string {
    return s.kind === "element" ? `${s.name}[${s.index}]` : s.name;
}

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
    const poseidon = await buildPoseidon();
    const babyJub = await buildBabyjub();
    const F = poseidon.F;

    const commit = (value: bigint, assetId: bigint, owner: bigint, blinding: bigint): bigint =>
        F.toObject(poseidon([value, assetId, owner, blinding]));

    const d = DEFAULTS;

    // Owner pubkey — matches the circuit's BabyPbk(spending_key).Ax
    const owner = F.toObject(babyJub.mulPointEscalar(babyJub.Base8, d.spendingKey)[0]);
    const commitment = commit(d.noteValue, d.assetId, owner, d.blinding);
    const nullifier = F.toObject(poseidon([commitment, d.spendingKey]));

    const { root, pathElements, pathIndices } = singleLeafTree(poseidon, commitment, d.leafIndex);

    // change_commitment is 0 for a total unshield — constraint 8b requires it.
    const changeCommitment =
        d.changeValue > 0n ? commit(d.changeValue, d.assetId, owner, d.changeBlinding) : 0n;

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

/**
 * A Merkle root and path for a tree holding a single leaf at `leafIndex`.
 *
 * Every sibling is the empty value, so the path is all zeroes — but written as
 * the general loop so a non-zero index still works.
 */
function singleLeafTree(
    poseidon: any,
    leaf: bigint,
    leafIndex: number
): { root: bigint; pathElements: bigint[]; pathIndices: number[] } {
    const F = poseidon.F;
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let level = new Map<number, bigint>([[leafIndex, leaf]]);

    for (let depth = 0; depth < TREE_DEPTH; depth++) {
        const nodeIdx = leafIndex >> depth;
        const isRight = nodeIdx % 2 === 1;
        pathIndices.push(isRight ? 1 : 0);
        pathElements.push(level.get(isRight ? nodeIdx - 1 : nodeIdx + 1) ?? 0n);

        const next = new Map<number, bigint>();
        for (const [pos] of level) {
            const parent = pos >> 1;
            if (next.has(parent)) continue;
            const l = level.get(parent * 2) ?? 0n;
            const r = level.get(parent * 2 + 1) ?? 0n;
            next.set(parent, F.toObject(poseidon([l, r])));
        }
        level = next;
    }
    return { root: level.get(0) ?? 0n, pathElements, pathIndices };
}

async function buildTransferInput(): Promise<Built> {
    const poseidon = await buildPoseidon();
    const babyJub = await buildBabyjub();
    const F = poseidon.F;
    const d = TRANSFER_DEFAULTS;

    const commit = (value: bigint, assetId: bigint, owner: bigint, blinding: bigint): bigint =>
        F.toObject(poseidon([value, assetId, owner, blinding]));

    // Slot 0 is a real note; slot 1 is a dummy (value 0).
    const owner = F.toObject(babyJub.mulPointEscalar(babyJub.Base8, d.spendingKey)[0]);
    const inputCommitment = commit(d.inputValue, d.assetId, owner, d.blinding);
    const nullifier = F.toObject(poseidon([inputCommitment, d.spendingKey]));

    const { root, pathElements, pathIndices } = singleLeafTree(
        poseidon,
        inputCommitment,
        d.leafIndex
    );

    // Constraint 5: sum(inputs) == sum(outputs) + fee.
    const outputValues = [d.inputValue - d.fee, 0n];
    const commitments = [0, 1].map((i) =>
        commit(outputValues[i], d.assetId, d.outputOwners[i], d.outputBlindings[i])
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
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const d = VALUE_PROOF_DEFAULTS;

    const commitment = F.toObject(poseidon([d.value, d.assetId, d.ownerPubkey, d.blinding]));
    const ownerHash = F.toObject(poseidon([d.ownerPubkey]));

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
    const circuit = process.argv[2] ?? "unshield";
    const outDir = path.resolve(ROOT, process.argv[3] ?? "fixtures");

    const build = BUILDERS[circuit];
    if (!build) {
        throw new Error(
            `No fixture builder for "${circuit}". Available: ${Object.keys(BUILDERS).join(", ")}`
        );
    }

    const wasmPath = path.join(ROOT, "build", `${circuit}_js`, `${circuit}.wasm`);
    if (!fs.existsSync(wasmPath)) {
        throw new Error(
            `Circuit wasm not found: ${wasmPath}. Run 'pnpm run compile:${circuit}' first.`
        );
    }

    fs.mkdirSync(outDir, { recursive: true });
    const inputPath = path.join(outDir, `${circuit}.input.json`);
    const wtnsPath = path.join(outDir, `${circuit}.wtns`);
    const decimalPath = path.join(outDir, `${circuit}.witness.json`);

    const signals = PUBLIC_SIGNALS[circuit];
    if (!signals) {
        throw new Error(`No public-signal layout for "${circuit}"`);
    }

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

    console.log(`\n✓ ${path.relative(ROOT, inputPath)}`);
    console.log(`✓ ${path.relative(ROOT, wtnsPath)} (${fs.statSync(wtnsPath).size} bytes)`);
    console.log(`✓ ${path.relative(ROOT, decimalPath)}`);
    console.log(`\n  witness elements:   ${witness.length}`);
    console.log(`  public signals:     ${signals.length}`);
    console.log(`  witness[0]:         ${witness[0]} (constant)`);
    console.log(
        `  witness[1..${signals.length}]:      verified — ${signals.map(signalName).join(", ")}`
    );
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
        process.exit(1);
    });
