/**
 * @orbinum/circuits - Circuit artifacts index
 *
 * Helper functions to load circuit artifacts
 */

const { join } = require("path");

const CIRCUITS = ["disclosure", "transfer", "unshield"];

/**
 * Get paths to all files for a specific circuit
 * @param {string} circuit - Circuit name: 'disclosure', 'transfer', or 'unshield'
 * @returns {Object} Paths to circuit files
 */
function getCircuitPaths(circuit) {
    if (!CIRCUITS.includes(circuit)) {
        throw new Error(`Invalid circuit: ${circuit}. Must be one of: ${CIRCUITS.join(", ")}`);
    }

    const basePath = __dirname;

    return {
        wasm: join(basePath, `${circuit}.wasm`),
        zkey: join(basePath, `${circuit}_pk.zkey`),
        ark: join(basePath, `${circuit}_pk.ark`),
        verificationKey: join(basePath, `verification_key_${circuit}.json`),
    };
}

module.exports = {
    getCircuitPaths,
    CIRCUITS,
};
