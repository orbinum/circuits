#!/usr/bin/env ts-node
/**
 * Static checks over the circom sources, then a real compile of each circuit.
 *
 * Ported from `lint-circom.sh`, which carried two defects that the shell made
 * easy to miss:
 *
 * 1. The warning counter never incremented. `warnings=$((warnings + 1))` sat
 *    after a `echo "$x" | while read` pipeline, and the pipeline's body runs in
 *    a subshell — so the count was lost and the summary always reported zero
 *    warnings, no matter how many it printed.
 *
 * 2. An unconstrained assignment (`<--`) was a warning forever. `<--` assigns a
 *    signal without constraining it, which is the classic way to write a circuit
 *    that proves nothing: the prover can put any value there. It is an error
 *    here, and `--allow-unconstrained` is the escape hatch for the rare case
 *    where it is deliberate.
 *
 * Usage:
 *   ts-node scripts/utils/lint-circom.ts [--allow-unconstrained] [files...]
 */
import fs from "fs";
import os from "os";
import path from "path";

import { CIRCUITS_DIR, ROOT, rel } from "../lib/paths";
import { die, green, info, ok, red, warn, yellow } from "../lib/log";
import { has, tryRun } from "../lib/run";

interface Finding {
    file: string;
    message: string;
    severity: "error" | "warning";
}

/** Every circom source, or the ones named on the command line. */
function targets(args: string[]): string[] {
    const files = args.filter((a) => !a.startsWith("--"));
    if (files.length > 0) return files.map((f) => path.resolve(ROOT, f));

    if (!fs.existsSync(CIRCUITS_DIR)) return [];
    return fs
        .readdirSync(CIRCUITS_DIR)
        .filter((f) => f.endsWith(".circom"))
        .sort()
        .map((f) => path.join(CIRCUITS_DIR, f));
}

/** Checks that need only the file's text. */
function staticChecks(file: string, allowUnconstrained: boolean): Finding[] {
    const found: Finding[] = [];
    const name = path.basename(file);
    const source = fs.readFileSync(file, "utf8");

    if (source.trim().length === 0) {
        found.push({ file: name, message: "file is empty", severity: "error" });
        return found;
    }
    if (!/pragma circom/.test(source)) {
        found.push({ file: name, message: "missing 'pragma circom'", severity: "error" });
    }

    // `<--` assigns without constraining. Comment lines are excluded; a `<--`
    // inside a block comment would slip through, which is a limitation worth
    // knowing rather than a reason to write a circom parser here.
    const unconstrained = source
        .split("\n")
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => line.includes("<--") && !line.startsWith("//"));

    for (const { line, n } of unconstrained) {
        found.push({
            file: name,
            message: `unconstrained assignment at line ${n}: ${line}`,
            severity: allowUnconstrained ? "warning" : "error",
        });
    }
    return found;
}

/**
 * Compile each top-level circuit, which is the only check that catches a real
 * syntax or semantic error.
 *
 * Runs from the repository root: circomlib is included by the relative path
 * `../node_modules/circomlib/...`, so it resolves from nowhere else.
 */
function compileChecks(files: string[]): Finding[] {
    if (!has("circom")) {
        warn(
            "circom not in PATH — skipping the compiler check. " +
                "Install: https://docs.circom.io/getting-started/installation/"
        );
        return [];
    }

    const version = tryRun("circom", ["--version"]).stdout.trim();
    info(`  using ${version}`);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "circom-lint-"));
    const found: Finding[] = [];
    try {
        for (const file of files) {
            const source = fs.readFileSync(file, "utf8");
            if (!source.includes("component main")) continue;

            const name = path.basename(file);
            const result = tryRun("circom", [rel(file), "--r1cs", "--O1", "-o", tmp]);
            if (result.ok) {
                ok(name);
                continue;
            }
            const detail = `${result.stdout}${result.stderr}`
                .split("\n")
                .filter((l) => /error/i.test(l))
                .slice(0, 15)
                .join("\n       ");
            found.push({
                file: name,
                message: `does not compile:\n       ${detail}`,
                severity: "error",
            });
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    return found;
}

function main(): void {
    const args = process.argv.slice(2);
    const allowUnconstrained = args.includes("--allow-unconstrained");
    const files = targets(args);

    if (files.length === 0) {
        ok("no circom files found");
        return;
    }

    info(yellow("Static checks"));
    const findings: Finding[] = [];
    for (const file of files) {
        const found = staticChecks(file, allowUnconstrained);
        findings.push(...found);
        if (found.length === 0) ok(path.basename(file));
    }

    info("");
    info(yellow("Compiler syntax check"));
    findings.push(...compileChecks(files));

    const errors = findings.filter((f) => f.severity === "error");
    const warnings = findings.filter((f) => f.severity === "warning");

    info("");
    for (const f of errors) info(`  ${red("✗")} ${f.file}: ${f.message}`);
    for (const f of warnings) info(`  ${yellow("⚠")} ${f.file}: ${f.message}`);

    if (errors.length > 0) {
        die(`lint failed: ${errors.length} error(s), ${warnings.length} warning(s)`);
    }
    info(
        green(`✓ all checks passed${warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""}`)
    );
}

main();
