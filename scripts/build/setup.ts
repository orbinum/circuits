#!/usr/bin/env ts-node
/**
 * Groth16 trusted setup for one circuit: ptau → proving key → verifying key.
 *
 * **This is a development ceremony, not a production one.** It contributes
 * entropy from a single party with a hardcoded default. A real setup needs many
 * independent contributors, any one of whom being honest is enough. Everything
 * here is reproducible on purpose, which is exactly what a production ceremony
 * must not be.
 *
 * Ported from `setup.sh`. Two defects the shell made easy to miss:
 *
 * 1. **No cleanup on failure.** There was no `trap`, so an abort between the
 *    initial key and the cleanup left `_0000.zkey` and `_0001.zkey` behind —
 *    multi-megabyte intermediates that the next run would silently overwrite.
 *    `try`/`finally` handles it here.
 *
 * 2. **snarkjs failures were invisible.** Four calls redirected to
 *    `/dev/null 2>&1`, so a failure produced a bare exit with no diagnostic.
 *    `capture: true` keeps the output quiet on success and prints it on failure,
 *    which is the behaviour the redirect was reaching for.
 *
 * Usage:
 *   ts-node scripts/build/setup.ts <circuit>
 *
 * Environment (overridable so a rotated version gets a distinct verifying key;
 * the defaults reproduce the original v1 setup byte for byte):
 *   SETUP_ENTROPY       contributor entropy
 *   SETUP_BEACON        final beacon value, hex
 *   SETUP_BEACON_ITERS  beacon iterations
 */
import crypto from "crypto";
import fs from "fs";

import { BUILD_DIR, KEYS_DIR, PTAU_DIR, rel, sourceArtifacts } from "../lib/paths";
import { banner, blue, cli, die, info, ok, warn, yellow } from "../lib/log";
import { parseCircuit } from "../lib/circuits";
import { requireTool, run, tryRun } from "../lib/run";

/** The powers-of-tau file every circuit's phase 2 builds on. */
const PTAU = `${PTAU_DIR}/pot16_final.ptau`;

/** Mirrors for the Hermez ceremony file, tried in order. */
const PTAU_SOURCES = [
    "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau",
    "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau",
];

/**
 * blake2b-512 of `powersOfTau28_hez_final_16.ptau`, as published in the snarkjs
 * README. A ceremony file that does not hash to this is not the Hermez
 * ceremony, whatever its size or where it came from.
 */
const PTAU_BLAKE2B =
    "6a6277a2f74e1073601b4f9fed6e1e55226917efb0f0db8a07d98ab01df1ccf43eb0e8c3159432acd4960e2f29fe84a4198501fa54c8dad9e43297453efec125";

const DEV_ENTROPY = "orbinum-dev-contribution";
const DEV_BEACON = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

export interface CeremonyConfig {
    entropy: string;
    beacon: string;
    beaconIters: string;
    /** Whether any value is a development default. */
    dev: boolean;
}

/**
 * The ceremony's inputs. Development defaults fill what is unset; with
 * `SETUP_CEREMONY=release` every value must be explicit, and the beacon must be
 * a 32-byte hex (a finalized block hash), or the setup refuses to run.
 */
export function ceremonyConfig(env: NodeJS.ProcessEnv = process.env): CeremonyConfig {
    const entropy = env.SETUP_ENTROPY;
    const beacon = env.SETUP_BEACON;
    const beaconIters = env.SETUP_BEACON_ITERS ?? "10";
    const dev = entropy === undefined || beacon === undefined;
    if (env.SETUP_CEREMONY === "release") {
        if (!entropy) throw new Error("SETUP_CEREMONY=release needs SETUP_ENTROPY");
        if (!beacon || !/^(0x)?[0-9a-fA-F]{64}$/.test(beacon)) {
            throw new Error(
                "SETUP_CEREMONY=release needs SETUP_BEACON as a 32-byte hex (a finalized block hash)"
            );
        }
    }
    return {
        entropy: entropy ?? DEV_ENTROPY,
        beacon: (beacon ?? DEV_BEACON).replace(/^0x/, ""),
        beaconIters,
        dev,
    };
}

/** Whether `file` is the Hermez ceremony file, byte for byte. */
export function isHermezPtau(file: string, expected = PTAU_BLAKE2B): boolean {
    const hash = crypto.createHash("blake2b512");
    hash.update(fs.readFileSync(file));
    return hash.digest("hex") === expected;
}

/**
 * Fetch the ptau file if it is not already present, and verify it either way.
 *
 * Downloads to a temporary name and only moves it into place once its hash
 * matches: `curl` without `-f` exits 0 on an HTTP error and writes the error
 * body to the output file, and a mirror could serve anything.
 */
function ensurePtau(): void {
    if (fs.existsSync(PTAU)) {
        if (!isHermezPtau(PTAU)) {
            die(`cached ptau ${rel(PTAU)} is not the Hermez ceremony file: delete it and rerun`);
        }
        ok("using cached ptau (hash verified)");
        return;
    }

    info("  downloading ceremony parameters (2^16 constraints, ~72 MB)");
    fs.mkdirSync(PTAU_DIR, { recursive: true });
    const partial = `${PTAU}.partial`;

    let fetched = false;
    for (const url of PTAU_SOURCES) {
        info(`  trying ${url}`);
        // -f turns an HTTP error into a non-zero exit instead of a written body.
        if (tryRun("curl", ["-fL", "--retry", "2", url, "-o", partial]).ok) {
            fetched = true;
            break;
        }
        fs.rmSync(partial, { force: true });
    }

    if (!fetched) {
        die("could not download the ptau file from any source");
    }

    if (!isHermezPtau(partial)) {
        fs.rmSync(partial, { force: true });
        die("downloaded ptau does not hash to the Hermez ceremony file: truncated, an error page, or tampered");
    }

    fs.renameSync(partial, PTAU);
    ok(`ptau downloaded (${fs.statSync(PTAU).size} bytes, hash verified)`);
}

/** Run snarkjs, surfacing its output only when it fails. */
function snarkjs(args: string[], input?: string): void {
    run("npx", ["snarkjs", ...args], { capture: true, input });
}

function main(): void {
    const [name] = process.argv.slice(2);
    if (!name) {
        die("usage: setup.ts <circuit>");
    }
    const circuit = parseCircuit(name);
    const { r1cs, zkey, vkJson } = sourceArtifacts(circuit);
    const { entropy, beacon, beaconIters, dev } = ceremonyConfig();

    if (!fs.existsSync(r1cs)) {
        die(`R1CS not found: ${rel(r1cs)}\n  Run 'pnpm run compile ${circuit}' first.`);
    }
    requireTool("npx", "Node.js ships it; snarkjs is a devDependency of this package");

    banner(`Trusted setup: ${circuit}`);
    if (dev) {
        warn("DEVELOPMENT CEREMONY: default entropy or beacon. Keys from this run must never be registered on a live chain.");
        warn("A release runs with SETUP_CEREMONY=release, SETUP_ENTROPY and a block-hash SETUP_BEACON.");
    }

    fs.mkdirSync(KEYS_DIR, { recursive: true });
    fs.mkdirSync(BUILD_DIR, { recursive: true });

    // Named individually rather than by glob: `${circuit}_*.zkey` would also
    // sweep up version-suffixed keys like `unshield_v2_pk.zkey`.
    const initial = `${KEYS_DIR}/${circuit}_0000.zkey`;
    const contributed = `${KEYS_DIR}/${circuit}_0001.zkey`;

    for (const stale of [zkey, vkJson, initial, contributed]) {
        fs.rmSync(stale, { force: true });
    }

    try {
        info(blue("\n[1/5] downloading powers of tau"));
        ensurePtau();

        info(blue("\n[2/5] phase 2 setup"));
        snarkjs(["groth16", "setup", r1cs, PTAU, initial]);
        ok("initial proving key");

        info(blue("\n[3/5] entropy contribution"));
        // Piped rather than passed as an argument: an argument would be visible
        // in the process table to every user on the machine.
        snarkjs(
            ["zkey", "contribute", initial, contributed, "--name=Dev Contribution 1"],
            `${entropy}\n`
        );
        ok("contribution recorded");

        info(blue("\n[4/5] final beacon"));
        snarkjs([
            "zkey",
            "beacon",
            contributed,
            zkey,
            beacon,
            beaconIters,
            "-n=Final Beacon phase2",
        ]);
        ok("proving key ready");

        info(blue("\n[5/5] exporting and verifying"));
        snarkjs(["zkey", "export", "verificationkey", zkey, vkJson]);
        ok("verifying key exported");

        // snarkjs reports a bad setup on stdout rather than by exit code, so the
        // output has to be read rather than the status trusted.
        const verify = tryRun("npx", ["snarkjs", "zkey", "verify", r1cs, PTAU, zkey]);
        const output = `${verify.stdout}${verify.stderr}`;
        if (!verify.ok || !output.includes("ZKey Ok!")) {
            die(`setup verification failed:\n${output.trim()}`);
        }
        ok("verification passed");
    } finally {
        // Runs on the failure path too, which the shell's trap-less cleanup did
        // not: an abort used to strand two multi-megabyte intermediates.
        for (const intermediate of [initial, contributed]) {
            fs.rmSync(intermediate, { force: true });
        }
    }

    const mb = (f: string) => (fs.statSync(f).size / 1_048_576).toFixed(2);
    info("");
    ok(`${rel(zkey)} (${mb(zkey)} MB)`);
    ok(`${rel(vkJson)} (${mb(vkJson)} MB)`);
    info("");
    info(`  next: ${yellow(`pnpm run convert ${circuit}`)}, then ${yellow("pnpm run manifest")}`);
}

if (require.main === module) cli(main);
