/**
 * Whether the compiled circuits are present, and what to do when they are not.
 *
 * Circuit tests need a compiled `.wasm`, which `pnpm build-all` produces. A
 * fresh checkout has none, so the suites skip rather than fail — that part is
 * deliberate and worth keeping.
 *
 * What was not safe is that the skip was silent and unbounded. `unshield.test.ts`
 * and `transfer.test.ts` between them carried 69 copies of
 * `if (!circuit) return this.skip()`, and their `before()` hooks left `circuit`
 * undefined after printing a warning nobody reads in CI. If `build-all` failed
 * partway, roughly ninety tests turned into pending and the job stayed green:
 * about eight pure-arithmetic assertions ran out of a hundred, and no output
 * distinguished that from a full pass.
 *
 * A suite that skips everything looks exactly like a suite that passes
 * everything. `CIRCUITS_REQUIRE_ARTIFACTS=1` is what tells them apart — CI sets
 * it, so absence becomes a failure where a human is not watching.
 */
import fs from "fs";

import type { WasmTester } from "circom_tester";

/** Whether the strict mode is on. CI sets it; a developer checkout does not. */
export const strict = (): boolean => Boolean(process.env.CIRCUITS_REQUIRE_ARTIFACTS);

/**
 * Load a circuit's compiled wasm path, or explain why it is missing.
 *
 * Returns `undefined` when the artifact is absent and strict mode is off, so
 * the caller can skip. Throws under strict mode.
 */
export function requireArtifact(wasmPath: string, circuit: string): string | undefined {
    if (fs.existsSync(wasmPath)) return wasmPath;

    const message =
        `${circuit}: compiled wasm not found at ${wasmPath}. ` +
        `Run 'pnpm build-all' to build it.`;

    if (strict()) {
        throw new Error(
            `${message}\n` +
                `CIRCUITS_REQUIRE_ARTIFACTS is set, so this is a failure rather than a skip — ` +
                `a skipped suite is indistinguishable from a passing one.`
        );
    }
    console.log(`  ⚠  ${message}`);
    return undefined;
}

/**
 * Guard a test case on the circuit having loaded.
 *
 * Call as the first line of a case that needs the circuit:
 *
 * ```ts
 * it("…", async function () {
 *     const c = needCircuit(circuit, "unshield", this);
 *     const w = await c.calculateWitness(input);
 * });
 * ```
 *
 * Under strict mode it throws instead of skipping, so a missing artifact fails
 * the run rather than quietly shrinking it.
 */
export function needCircuit(
    circuit: WasmTester | undefined,
    name: string,
    ctx: Mocha.Context
): WasmTester {
    if (circuit) return circuit;

    if (strict()) {
        throw new Error(
            `${name}: the circuit is not loaded and CIRCUITS_REQUIRE_ARTIFACTS is set. ` +
                `The suite would have skipped silently.`
        );
    }
    ctx.skip();
}
