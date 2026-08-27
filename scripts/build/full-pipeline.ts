#!/usr/bin/env ts-node
/**
 * Compile → trusted setup → pack the proving key, for one circuit.
 *
 * Ported from `full-pipeline.sh`, which swallowed the failure of its own last
 * phase:
 *
 * ```sh
 * bash scripts/build/pack-proving-key.sh "$CIRCUIT" || echo "⚠ Conversion skipped (non-critical)"
 * ```
 *
 * It was not non-critical. That line — combined with a guard that tested for a
 * binary which never existed — meant every build silently skipped `.ark`
 * generation for a month, which is how the checked-in keys drifted behind their
 * `.zkey` and how `manifest.json` ended up with no `ark` entries at all. The
 * file's own header comment documents the incident.
 *
 * So a failed conversion fails the build. `--allow-skip-ark` is the explicit
 * opt-out, for a machine without Rust that only needs the snarkjs artifacts.
 *
 * Usage:
 *   ts-node scripts/build/full-pipeline.ts <circuit> [--allow-skip-ark]
 */
import { cli, banner, die, info, ok, warn } from "../lib/log";
import { run } from "../lib/run";
import { canPack } from "./pack-proving-key";
import { parseCircuit } from "../lib/circuits";

function main(): void {
    const args = process.argv.slice(2);
    const name = args.find((a) => !a.startsWith("--"));
    if (!name) die("usage: full-pipeline.ts <circuit> [--allow-skip-ark]");

    const circuit = parseCircuit(name);
    const allowSkipArk = args.includes("--allow-skip-ark");

    banner(`Build pipeline: ${circuit}`);

    info("[1/3] compiling");
    run("npx", ["ts-node", "scripts/build/compile.ts", circuit]);

    info("");
    info("[2/3] trusted setup");
    run("npx", ["ts-node", "scripts/build/setup.ts", circuit]);

    info("");
    info("[3/3] packing the proving key");
    if (!canPack()) {
        if (!allowSkipArk) {
            die(
                "the .ark artifact cannot be built: no pack-proving-key binary, and no " +
                    "groth16-proofs checkout with cargo to build one. Clone it beside this " +
                    "repository, set GROTH16_PROOFS_DIR or PACK_PROVING_KEY_BIN, or pass " +
                    "--allow-skip-ark to build only the snarkjs artifacts."
            );
        }
        warn("no pack-proving-key available — skipping .ark because --allow-skip-ark was passed");
    } else {
        run("npx", ["ts-node", "scripts/build/pack-proving-key.ts", circuit]);
    }

    info("");
    ok(`${circuit} built`);
}

cli(main);
