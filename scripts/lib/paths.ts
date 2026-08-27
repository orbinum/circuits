/**
 * Where everything lives, resolved once.
 *
 * The repository root was derived independently in ten places, in three
 * spellings: `$(cd "$SCRIPT_DIR/.." && pwd)` in `build-all.sh`, the same with
 * `../..` in three other shell scripts, and `path.resolve(__dirname, "../../")`
 * in four TypeScript ones. Three shell scripts had no preamble at all and just
 * assumed the working directory was already the root — so half the pipeline was
 * cwd-independent and half was not.
 */
import path from "path";

/** The repository root, regardless of where a script was invoked from. */
export const ROOT = path.resolve(__dirname, "..", "..");

export const CIRCUITS_DIR = path.join(ROOT, "circuits");
export const BUILD_DIR = path.join(ROOT, "build");
export const KEYS_DIR = path.join(ROOT, "keys");
export const PTAU_DIR = path.join(ROOT, "ptau");
export const FIXTURES_DIR = path.join(ROOT, "fixtures");
export const MANIFEST_PATH = path.join(ROOT, "manifest.json");
export const PACKAGE_JSON = path.join(ROOT, "package.json");

/** The circom source for a circuit. */
export const circuitSource = (circuit: string): string =>
    path.join(CIRCUITS_DIR, `${circuit}.circom`);

/**
 * A circuit's build artifacts.
 *
 * `suffix` carries the version marker for a rotated key: an artifact for
 * version 2 is `unshield_v2_pk.zkey`, and the suffixed name is required so two
 * versions do not collide in the flat directory the npm package serves.
 */
export function artifacts(circuit: string, suffix = "") {
    const name = `${circuit}${suffix}`;
    return {
        wasm: path.join(BUILD_DIR, `${circuit}_js`, `${name}.wasm`),
        wasmDir: path.join(BUILD_DIR, `${circuit}_js`),
        r1cs: path.join(BUILD_DIR, `${name}.r1cs`),
        sym: path.join(BUILD_DIR, `${name}.sym`),
        vkJson: path.join(BUILD_DIR, `verification_key_${name}.json`),
        zkey: path.join(KEYS_DIR, `${name}_pk.zkey`),
        ark: path.join(KEYS_DIR, `${name}_pk.ark`),
    };
}

/** A circuit's deterministic test fixture. */
export function fixtures(circuit: string) {
    return {
        input: path.join(FIXTURES_DIR, `${circuit}.input.json`),
        wtns: path.join(FIXTURES_DIR, `${circuit}.wtns`),
        witnessJson: path.join(FIXTURES_DIR, `${circuit}.witness.json`),
    };
}

/** A path relative to the root, for messages that should not leak absolute paths. */
export const rel = (p: string): string => path.relative(ROOT, p);
