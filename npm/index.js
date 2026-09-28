/**
 * @orbinum/circuits - Circuit artifacts index
 *
 * Helper functions to load circuit artifacts
 */

const { join } = require("path");
const manifest = require("./manifest.json");

const CIRCUITS = ["transfer", "unshield"];

/**
 * Get paths to all files of one version of a circuit
 * @param {string} circuit - Circuit name: 'transfer' or 'unshield'
 * @param {number} [version] - Circuit version; defaults to the active one
 * @returns {Object} Paths to circuit files, and the version they belong to
 */
function getCircuitPaths(circuit, version) {
    if (!CIRCUITS.includes(circuit)) {
        throw new Error(`Invalid circuit: ${circuit}. Must be one of: ${CIRCUITS.join(", ")}`);
    }

    const entry = manifest.circuits[circuit];
    const v = version ?? entry.active_version;
    const published = entry.versions[String(v)];
    if (!published) {
        throw new Error(
            `${circuit} has no version ${v}; this package ships ${Object.keys(entry.versions).join(", ")}`
        );
    }

    const file = (kind) =>
        published.artifacts[kind] && join(__dirname, published.artifacts[kind].file);

    return {
        version: v,
        wasm: file("wasm"),
        r1cs: file("r1cs"),
        zkey: file("zkey"),
        ark: file("ark"),
        verificationKey: file("vk_json"),
    };
}

module.exports = {
    getCircuitPaths,
    CIRCUITS,
};
