/**
 * The scripts that write files must write the same files twice.
 *
 * Two of this repository's outputs are load-bearing in a way that makes
 * non-determinism a correctness bug rather than an annoyance:
 *
 * - **Fixtures** are golden vectors. `make-fixture.ts` builds a note, a Merkle
 *   path and a witness from hardcoded scalars precisely so the same statement
 *   is proved every run. A random blinding would mean each regeneration proved
 *   something different, and a cross-implementation test comparing against a
 *   stored fixture would be comparing against noise.
 *
 * - **The manifest** records a sha256 per artifact and the `vk_hash` the chain
 *   registers a verifying key by. If regenerating it changed those, every
 *   release would look like an artifact change.
 *
 * These run the real scripts and compare bytes. They are slower than the rest
 * of the suite, and they are the only tests that would catch a `Date.now()` or
 * a `Math.random()` finding its way into a builder.
 */
import { execFileSync } from "child_process";
import fs from "fs";

import { expect } from "chai";

import { CIRCUITS } from "../../scripts/lib/circuits";
import { MANIFEST_PATH, ROOT, artifacts, fixtures } from "../../scripts/lib/paths";

/** Run a repository script, failing the test with its output. */
function script(args: string[]): void {
    try {
        execFileSync("npx", ["ts-node", ...args], { cwd: ROOT, stdio: "pipe" });
    } catch (err) {
        const e = err as { stdout?: Buffer; stderr?: Buffer };
        const failure = new Error(
            `${args.join(" ")} failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`.slice(0, 2000)
        );
        // `cause` is an ES2022 constructor option and this project targets
        // ES2020, so it is attached rather than passed.
        (failure as Error & { cause?: unknown }).cause = err;
        throw failure;
    }
}

describe("Script determinism", function () {
    // Regenerating a fixture recomputes a witness, which for transfer means
    // 33,730 field elements.
    this.timeout(300_000);

    describe("make-fixture", () => {
        for (const circuit of CIRCUITS) {
            it(`${circuit}: regenerating produces byte-identical files`, function () {
                const f = fixtures(circuit);
                const wasm = artifacts(circuit).wasm;

                if (!fs.existsSync(f.input) || !fs.existsSync(wasm)) {
                    if (process.env.CIRCUITS_REQUIRE_ARTIFACTS) {
                        throw new Error(
                            `${circuit}: fixture or compiled wasm missing — run 'pnpm build-all' ` +
                                `and 'pnpm run fixture ${circuit}' first`
                        );
                    }
                    return this.skip();
                }

                const before = {
                    input: fs.readFileSync(f.input),
                    witness: fs.existsSync(f.witnessJson) ? fs.readFileSync(f.witnessJson) : null,
                    wtns: fs.existsSync(f.wtns) ? fs.readFileSync(f.wtns) : null,
                };

                script(["scripts/utils/make-fixture.ts", circuit]);

                expect(
                    fs.readFileSync(f.input).equals(before.input),
                    "input.json changed"
                ).to.equal(true);
                if (before.witness) {
                    expect(
                        fs.readFileSync(f.witnessJson).equals(before.witness),
                        "witness.json changed"
                    ).to.equal(true);
                }
                if (before.wtns) {
                    expect(fs.readFileSync(f.wtns).equals(before.wtns), ".wtns changed").to.equal(
                        true
                    );
                }
            });
        }
    });

    describe("generate-manifest", () => {
        it("regenerating changes nothing but the timestamp", function () {
            if (!fs.existsSync(MANIFEST_PATH)) return this.skip();

            const before = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
            const backup = fs.readFileSync(MANIFEST_PATH);

            try {
                script(["scripts/utils/generate-manifest.ts"]);
                const after = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

                // `generated_at` is the one field that is meant to move.
                delete before.generated_at;
                delete after.generated_at;
                expect(after).to.deep.equal(
                    before,
                    "the regenerated manifest differs from the committed one. If this " +
                        "commit changes a .circom, that is expected — the compiled wasm and " +
                        "r1cs moved, so the manifest that describes them has to move too. " +
                        "Run 'pnpm run manifest' and commit the result."
                );
            } catch (err) {
                // A missing pack-verifying-key binary is a skip, not a failure:
                // the manifest's vk_hash cannot be recomputed without it.
                const message = String(err);
                if (/pack-verifying-key|convert-vk/.test(message)) {
                    fs.writeFileSync(MANIFEST_PATH, backup);
                    return this.skip();
                }
                throw err;
            } finally {
                // Restore regardless: the timestamp moved even on success, and
                // leaving that behind would dirty the working tree.
                fs.writeFileSync(MANIFEST_PATH, backup);
            }
        });
    });

    describe("compile", () => {
        // The .r1cs and .wasm are what every proof is built against, so a
        // recompile producing different bytes would silently invalidate every
        // key derived from the previous ones.
        it("value_proof: recompiling produces byte-identical artifacts", function () {
            const a = artifacts("value_proof");
            if (!fs.existsSync(a.r1cs)) {
                if (process.env.CIRCUITS_REQUIRE_ARTIFACTS) {
                    throw new Error("value_proof not compiled — run 'pnpm build-all' first");
                }
                return this.skip();
            }

            const before = {
                r1cs: fs.readFileSync(a.r1cs),
                wasm: fs.readFileSync(a.wasm),
            };

            script(["scripts/build/compile.ts", "value_proof"]);

            expect(fs.readFileSync(a.r1cs).equals(before.r1cs), ".r1cs changed").to.equal(true);
            expect(fs.readFileSync(a.wasm).equals(before.wasm), ".wasm changed").to.equal(true);
        });
    });
});
