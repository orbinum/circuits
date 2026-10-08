#!/usr/bin/env ts-node
/**
 * Static checks over the circom sources, then a real compile of each circuit
 * with `--inspect`.
 *
 * `<--` assigns a signal without constraining it — the classic way to write a
 * circuit that proves nothing — so it is an error, with `--allow-unconstrained`
 * as the escape hatch for a deliberate use. `--inspect` reports signals that no
 * constraint touches; the ones circomlib leaves unused by design are listed in
 * `INSPECT_ALLOWED`, anything else fails.
 *
 * Usage:
 *   ts-node scripts/utils/lint-circom.ts [--allow-unconstrained] [files...]
 */
import fs from "fs";
import os from "os";
import path from "path";

import { CIRCUITS_DIR, ROOT, rel } from "../lib/paths";
import { cli, die, green, info, ok, red, warn, yellow } from "../lib/log";
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
 * `--inspect` warnings that are expected: internal signals of circomlib
 * templates, and the bit outputs of range checks, whose only job is to exist.
 * Matched against the warning text with the ANSI colour stripped.
 */
const INSPECT_ALLOWED: readonly RegExp[] = [
    /In template "EscalarMulFix\(.*\)": .*segments\[\d+\]\.dbl/,
    /In template "LessThan\(252\)": .*n2b\.out/,
    /In template "SpendingKeyOwner\(\)": .*pbk\.Ay/,
    /In template "(Transfer|Unshield)\(\d+\)": .*_range_checks?(\[\d+\])?\.out/,
];

// Built from a string: an escape character in a regex literal trips `no-control-regex`.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string): string => s.replace(ANSI, "");

/**
 * Compile each top-level circuit, the only check that catches a real syntax or
 * semantic error, and read what `--inspect` says about unconstrained signals.
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
            const result = tryRun("circom", [rel(file), "--r1cs", "--O1", "--inspect", "-o", tmp]);
            const output = stripAnsi(`${result.stdout}${result.stderr}`);
            if (!result.ok) {
                const detail = output
                    .split("\n")
                    .filter((l) => /error/i.test(l))
                    .slice(0, 15)
                    .join("\n       ");
                found.push({
                    file: name,
                    message: `does not compile:\n       ${detail}`,
                    severity: "error",
                });
                continue;
            }
            const unexpected = output
                .split("\n")
                .filter((l) => /warning\[CA\d+\]/.test(l))
                .map((l) => l.replace(/^.*warning\[(CA\d+)\]:\s*/, "$1 "))
                .filter((l) => !INSPECT_ALLOWED.some((re) => re.test(l)));
            for (const line of unexpected) {
                found.push({
                    file: name,
                    message: `unconstrained signal: ${line}`,
                    severity: "error",
                });
            }
            if (unexpected.length === 0) ok(name);
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
    info(yellow("Compiler check (--inspect)"));
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

cli(main);
