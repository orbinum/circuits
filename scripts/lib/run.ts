/**
 * Running external tools, and checking they exist first.
 *
 * The pipeline shells out to circom, snarkjs, cargo, git and gh. Presence was
 * checked four different ways across the scripts — `command -v circom`,
 * `command -v snarkjs`, `[ ! -x "$CONVERTER" ]`, and a `for tool in ...` loop —
 * and only one of them produced a useful message.
 *
 * The rule here is that a missing tool says what to install and why the script
 * needed it, because "command not found: circom" three levels into a build tells
 * a reader nothing they can act on.
 */
import { execFileSync, spawnSync } from "child_process";

import { die } from "./log";
import { ROOT } from "./paths";

/** Whether an executable is on PATH. */
export function has(tool: string): boolean {
    const probe = spawnSync(
        process.platform === "win32" ? "where" : "command",
        process.platform === "win32" ? [tool] : ["-v", tool],
        { stdio: "ignore", shell: process.platform !== "win32" }
    );
    return probe.status === 0;
}

/** Exit with an actionable message unless `tool` is available. */
export function requireTool(tool: string, install: string): void {
    if (!has(tool)) {
        die(`${tool} not found. Install it: ${install}`);
    }
}

export interface RunOptions {
    /** Working directory; defaults to the repository root, not the caller's cwd. */
    cwd?: string;
    /** Capture stdout instead of inheriting it. */
    capture?: boolean;
    /** Extra environment for the child. */
    env?: NodeJS.ProcessEnv;
}

/**
 * Run a command, exiting with its output on failure.
 *
 * Defaults to `cwd: ROOT` because circom's include paths are relative
 * (`../node_modules/circomlib/...`) and only resolve from the repository root.
 * Three shell scripts relied on the caller having already cd'd there.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): string {
    const { capture = false, cwd = ROOT, env } = opts;
    const result = spawnSync(cmd, args, {
        cwd,
        env,
        stdio: capture ? (["ignore", "pipe", "pipe"] as const) : ("inherit" as const),
        encoding: "utf8" as const,
    });

    if (result.error) {
        die(`${cmd} could not be started: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const detail = capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd() : "";
        die(`${cmd} ${args.join(" ")} exited ${result.status}${detail}`);
    }
    return capture ? (result.stdout ?? "") : "";
}

/**
 * Run a command and return its outcome rather than exiting.
 *
 * For the cases where a failure is information, not an error — probing whether
 * a binary works, or a step the caller has decided may be skipped.
 */
export function tryRun(
    cmd: string,
    args: string[],
    opts: RunOptions = {}
): { ok: boolean; stdout: string; stderr: string } {
    const { cwd = ROOT, env } = opts;
    const result = spawnSync(cmd, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"] as const,
        encoding: "utf8" as const,
    });
    return {
        ok: result.status === 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
    };
}

/** A pnpm script in this repository. */
export function pnpm(script: string, args: string[] = []): void {
    run("pnpm", ["run", script, ...args]);
}

export { execFileSync };
