/**
 * The version rotation in progress, from `ROTATE_CIRCUIT` (one circuit or a
 * comma-separated list) and `ROTATE_VERSION`.
 *
 * Read in one place so the build, the manifest and the fixtures agree on which
 * version the sources are. Names are validated: a typo such as
 * `ROTATE_CIRCUIT=trasnfer` must fail, not quietly build the active version
 * over its published artifacts.
 */
import { type CircuitName, parseCircuit } from "./circuits";

export interface Rotation {
    /** Circuits being rotated; empty when no rotation is in progress. */
    readonly circuits: readonly CircuitName[];
    /** The version the rotated circuits build; 0 when none. */
    readonly version: number;
}

export function rotation(env: NodeJS.ProcessEnv = process.env): Rotation {
    const circuits = (env.ROTATE_CIRCUIT ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
        .map(parseCircuit);
    if (circuits.length === 0) return { circuits, version: 0 };

    const version = Number(env.ROTATE_VERSION ?? "0");
    if (!Number.isInteger(version) || version < 1) {
        throw new Error(
            `ROTATE_CIRCUIT=${circuits.join(",")} needs ROTATE_VERSION set to a positive ` +
                `integer, got ${env.ROTATE_VERSION ?? "(unset)"}`
        );
    }
    return { circuits, version };
}

/** The version `circuit` builds under `r`, or `undefined` when it is not rotating. */
export function rotatedVersion(r: Rotation, circuit: CircuitName): number | undefined {
    return r.circuits.includes(circuit) ? r.version : undefined;
}
