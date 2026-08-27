#!/usr/bin/env ts-node
/**
 * Compile one circuit to R1CS, wasm and symbols.
 *
 * Ported from `compile.sh`, which had three defects:
 *
 * 1. It printed `${BLUE}` on four lines without ever defining it — the colour
 *    block was copied from another script that had one more colour. Those lines
 *    rendered with an empty prefix. That is what a shared `log` module prevents.
 *
 * 2. `set -e` was on, so the `if [ $? -eq 0 ]` after `circom` could never see a
 *    failure: a non-zero exit killed the script before the test ran. The `else`
 *    branch that printed "Compilation failed" was unreachable.
 *
 * 3. The closing "Next Steps" pointed at `npm run prove:X` and
 *    `npm run verify:X`, neither of which exists in this package.
 *
 * Usage:
 *   ts-node scripts/build/compile.ts <circuit>
 */
import fs from "fs";

import { BUILD_DIR, artifacts, circuitSource, rel } from "../lib/paths";
import { cli, banner, die, info, ok, step, yellow } from "../lib/log";
import { parseCircuit, scriptName } from "../lib/circuits";
import { requireTool, run, tryRun } from "../lib/run";

/** Constraint and wire counts, which snarkjs reports and nothing else does. */
function stats(r1cs: string): { constraints?: string; wires?: string } {
    const probe = tryRun("npx", ["snarkjs", "r1cs", "info", rel(r1cs)]);
    if (!probe.ok) return {};
    const find = (label: string): string | undefined =>
        probe.stdout
            .split("\n")
            .find((l) => l.includes(label))
            ?.trim()
            .split(/\s+/)
            .pop();
    return { constraints: find("# of Constraints"), wires: find("# of Wires") };
}

function main(): void {
    const [name] = process.argv.slice(2);
    if (!name) die("usage: compile.ts <circuit>");

    const circuit = parseCircuit(name);
    const source = circuitSource(circuit);
    if (!fs.existsSync(source)) {
        die(`circuit source not found: ${rel(source)}`);
    }

    requireTool("circom", "https://docs.circom.io/getting-started/installation/");

    banner(`Compiling ${circuit}`);
    info(`  ${tryRun("circom", ["--version"]).stdout.trim()}`);

    // A stale .r1cs beside a fresh .wasm is a circuit that proves one statement
    // and verifies another, so the old outputs go first.
    const out = artifacts(circuit);
    const stale = [out.r1cs, out.sym].filter(fs.existsSync);
    if (stale.length > 0 || fs.existsSync(out.wasmDir)) {
        step("  removing previous build artifacts");
        stale.forEach((f) => fs.rmSync(f));
        fs.rmSync(out.wasmDir, { recursive: true, force: true });
    }

    fs.mkdirSync(BUILD_DIR, { recursive: true });

    step("  compiling");
    run("circom", [rel(source), "--r1cs", "--wasm", "--sym", "--O1", "-o", rel(BUILD_DIR)]);
    ok(`compiled ${circuit}`);

    const { constraints, wires } = stats(out.r1cs);
    if (constraints) {
        info("");
        info(`  ${yellow("•")} constraints: ${constraints}`);
        info(`  ${yellow("•")} wires:       ${wires ?? "?"}`);
    }

    info("");
    info(`  next: pnpm run setup ${scriptName(circuit)}`);
}

cli(main);
