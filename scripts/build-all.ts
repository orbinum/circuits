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
 */
import { CIRCUITS } from "./lib/circuits";
import { banner, info, ok } from "./lib/log";
import { run } from "./lib/run";

function main(): void {
    const args = process.argv.slice(2);

    banner("Building all circuits");
    info(`  ${CIRCUITS.join(", ")}`);
    info("");

    CIRCUITS.forEach((circuit, i) => {
        info(`[${i + 1}/${CIRCUITS.length}] ${circuit}`);
        run("npx", ["ts-node", "scripts/build/full-pipeline.ts", circuit, ...args]);
        info("");
    });

    ok(`built ${CIRCUITS.length} circuits`);
}

main();
