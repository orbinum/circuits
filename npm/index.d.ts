/**
 * @orbinum/circuits - Circuit artifacts index
 *
 * Helper functions to load circuit artifacts
 */

export interface CircuitPaths {
    wasm: string;
    r1cs: string;
    zkey: string;
    ark: string;
    verificationKey: string;
}

/**
 * Get paths to all files for a specific circuit
 */
export function getCircuitPaths(circuit: "value_proof" | "transfer" | "unshield"): CircuitPaths;

/**
 * Available circuits
 */
export type CircuitType = "value_proof" | "transfer" | "unshield";

export const CIRCUITS: CircuitType[];
