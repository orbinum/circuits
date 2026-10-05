/**
 * @orbinum/circuits - Circuit artifacts index
 *
 * Helper functions to load circuit artifacts
 */

export interface CircuitPaths {
    /** The circuit version these files belong to */
    version: number;
    wasm: string;
    r1cs: string;
    zkey: string;
    ark: string;
    verificationKey: string;
}

/**
 * Get paths to all files of one version of a circuit (default: the active one)
 */
export function getCircuitPaths(circuit: CircuitType, version?: number): CircuitPaths;

/**
 * Available circuits
 */
export type CircuitType = "transfer" | "unshield" | "shield";

export const CIRCUITS: CircuitType[];
