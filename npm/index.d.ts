/**
 * @orbinum/circuits - Circuit artifacts index
 *
 * Helper functions to load circuit artifacts
 */

export interface CircuitPaths {
    wasm: string;
    zkey: string;
    ark: string;
    verificationKey: string;
}

/**
 * Get paths to all files for a specific circuit
 */
export function getCircuitPaths(circuit: "disclosure" | "transfer" | "unshield"): CircuitPaths;

/**
 * Available circuits
 */
export type CircuitType = "disclosure" | "transfer" | "unshield";

export const CIRCUITS: CircuitType[];
