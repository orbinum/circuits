#!/usr/bin/env ts-node
/**
 * Build every circuit, end to end.
 *
 * Ported from `build-all.sh`. The shell version hardcoded the circuit list and
 * translated names inline with `${CIRCUIT//_/-}`, one of five places that knew
 * which circuits exist.
 *
 * Usage:
 *   ts-node scripts/build-all.ts [--allow-skip-ark]
 *   ts-node scripts/build-all.ts --compile-only
 *
 * `--compile-only` stops after circom and the fixtures, skipping the trusted
 * setup. That is what CI wants: the ceremony is nondeterministic, so the zkeys
 * and verifying keys it produces can never match the sha256 the manifest
 * records — they are built and then discarded. Compiling takes about six
 * seconds; the full ceremony downloads 72 MB of powers-of-tau and runs three
 * setups. The canonical keys come from `release:restore` instead.
 *
 * The fixtures are regenerated with the wasm, not separately: `.wtns` files are
 * gitignored and derived from it, so a fixture built against a stale wasm is a
 * witness for a circuit that no longer exists. Measured the hard way — editing a
 * circuit and regenerating only the fixture produced a witness of the wrong
 * length, which `groth16.prove` rejects with "Invalid witness length".
 */
import { CIRCUITS } from "./lib/circuits";
import { cli, banner, info, ok } from "./lib/log";
import { run } from "./lib/run";

function main(): void {
    const args = process.argv.slice(2);
    const compileOnly = args.includes("--compile-only");
    const rest = args.filter((a) => a !== "--compile-only");

    banner(compileOnly ? "Compiling all circuits" : "Building all circuits");
    info(`  ${CIRCUITS.join(", ")}`);
    info("");

    CIRCUITS.forEach((circuit, i) => {
        info(`[${i + 1}/${CIRCUITS.length}] ${circuit}`);
        if (compileOnly) {
            run("npx", ["ts-node", "scripts/build/compile.ts", circuit]);
            run("npx", ["ts-node", "scripts/utils/make-fixture.ts", circuit]);
        } else {
            run("npx", ["ts-node", "scripts/build/full-pipeline.ts", circuit, ...rest]);
        }
        info("");
    });

    ok(compileOnly ? `compiled ${CIRCUITS.length} circuits` : `built ${CIRCUITS.length} circuits`);
}

cli(main);
