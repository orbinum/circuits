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
 * How many public signals each circuit has.
 *
 * Written by hand so it is an independent source: the verifying key and the
 * `.r1cs` state the same fact, and `test/metadata.test.ts` requires all three
 * to agree. A table derived from the thing it checks proves nothing.
 *
 * `value_proof` has four from three declared inputs — `owner_hash` is a
 * `signal output`, and Circom places outputs *before* public inputs in the
 * witness.
 */
export const PUBLIC_SIGNALS: Record<CircuitName, number> = {
    value_proof: 4,
    transfer: 7,
    unshield: 7,
};
