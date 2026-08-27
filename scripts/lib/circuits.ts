/**
 * The circuits this package builds, and the two names each one has.
 *
 * A circuit is `value_proof` on disk and `value-proof` in a pnpm script, and
 * the two were bridged ad hoc: `build-all.sh:42` did `${CIRCUIT//_/-}`, the
 * package.json spelled out all fifteen combinations by hand, and the list of
 * circuit names itself appeared in five places. Adding a fourth circuit meant
 * finding all of them.
 */

/** A circuit's canonical name — the one used on disk and in the manifest. */
export type CircuitName = "value_proof" | "transfer" | "unshield";

/**
 * Every circuit, in manifest order.
 *
 * `value_proof` leads because it is the smallest, so a pipeline that breaks
 * breaks quickly.
 */
export const CIRCUITS: readonly CircuitName[] = ["value_proof", "transfer", "unshield"] as const;

/** The pnpm-script spelling: `value_proof` → `value-proof`. */
export function scriptName(circuit: CircuitName): string {
    return circuit.replace(/_/g, "-");
}

/** The disk spelling, from either form. Throws on an unknown name. */
export function parseCircuit(name: string): CircuitName {
    const canonical = name.replace(/-/g, "_");
    if (!isCircuit(canonical)) {
        throw new Error(`unknown circuit "${name}" — expected one of ${CIRCUITS.join(", ")}`);
    }
    return canonical;
}

export function isCircuit(name: string): name is CircuitName {
    return (CIRCUITS as readonly string[]).includes(name);
}

/**
 * One public signal: a plain input, one element of an array input, or a circuit
 * output that has no corresponding input at all.
 */
export type Signal =
    | { kind: "input"; name: string }
    | { kind: "element"; name: string; index: number }
    | { kind: "output"; name: string };

const input = (name: string): Signal => ({ kind: "input", name });
const element = (name: string, index: number): Signal => ({ kind: "element", name, index });
const output = (name: string): Signal => ({ kind: "output", name });

/**
 * The public-signal layout of each circuit, in witness order.
 *
 * The order is load-bearing. The witness carries public signals at indices
 * `1..=n` in exactly this sequence, and a prover that assumes a different one
 * produces a proof that is well-formed, is exactly 128 bytes, and fails
 * verification with nothing in the output to say why.
 *
 * Two entries are not what a reader of the circom would guess:
 *
 * - **`transfer`** declares five names but has seven signals: `nullifiers` and
 *   `commitments` are arrays of two, flattened one after the other rather than
 *   interleaved.
 * - **`value_proof`** declares three inputs and has four signals. `owner_hash`
 *   is a `signal output`, and **Circom places outputs before public inputs in
 *   the witness** — so it is signal 0, not the last. The circuit's own header
 *   comment lists it last; the header is describing the on-chain byte layout,
 *   which is a different thing. `scripts/utils/make-fixture.ts` asserts this
 *   against the real witness every time a fixture is generated, which is how it
 *   is known rather than believed.
 */
export const SIGNAL_LAYOUT: Record<CircuitName, readonly Signal[]> = {
    value_proof: [output("owner_hash"), input("commitment"), input("value"), input("asset_id")],
    transfer: [
        input("merkle_root"),
        element("nullifiers", 0),
        element("nullifiers", 1),
        element("commitments", 0),
        element("commitments", 1),
        input("asset_id"),
        input("fee"),
    ],
    unshield: [
        input("merkle_root"),
        input("nullifier"),
        input("amount"),
        input("recipient"),
        input("asset_id"),
        input("fee"),
        input("change_commitment"),
    ],
};

/**
 * How many public signals each circuit has.
 *
 * Derived from `SIGNAL_LAYOUT` rather than written separately: the two used to
 * be independent tables that had to agree, and nothing checked that they did.
 * Deriving it removes the question.
 *
 * This is still an independent source *from the artifacts* — the verifying key
 * and the `.r1cs` state the same fact by their own route, and
 * `test/metadata.test.ts` requires all three to agree. A table derived from the
 * thing it checks would prove nothing; this one is derived from a hand-written
 * layout, which is the point.
 */
export const PUBLIC_SIGNALS: Record<CircuitName, number> = Object.fromEntries(
    CIRCUITS.map((c) => [c, SIGNAL_LAYOUT[c].length])
) as Record<CircuitName, number>;

/** A human-readable name for a signal, for assertion messages. */
export function signalName(s: Signal): string {
    return s.kind === "element" ? `${s.name}[${s.index}]` : s.name;
}

/**
 * The value a signal should hold, given the circuit input it was built from.
 *
 * `outputs` carries the expected values of any `signal output`, which by
 * definition do not appear in the input JSON.
 */
export function signalValue(
    signal: Signal,
    circuitInput: Record<string, unknown>,
    outputs: Record<string, bigint>
): bigint {
    switch (signal.kind) {
        case "input":
            return BigInt(circuitInput[signal.name] as string);
        case "element":
            return BigInt((circuitInput[signal.name] as string[])[signal.index]);
        case "output": {
            const value = outputs[signal.name];
            if (value === undefined) {
                throw new Error(
                    `builder did not report the expected value of output "${signal.name}"`
                );
            }
            return value;
        }
    }
}
