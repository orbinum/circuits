/**
 * The two `scripts/lib` modules that decide whether a failure is seen.
 *
 * `run.ts` is what every build script uses to invoke circom, snarkjs and cargo,
 * and `log.ts` is how they report. Neither had a test, which is a gap worth
 * naming: the whole point of porting the shell scripts was that they swallowed
 * failures — `full-pipeline.sh` turned a failed `.ark` conversion into a
 * warning and shipped for a month without one. If `run()` stopped propagating a
 * non-zero exit, that class of bug would come straight back and every existing
 * test would still pass.
 *
 * `test/helpers/artifacts.ts` is covered here for the same reason: it is the
 * module that turns a silently-skipped suite into a failure, and if `strict()`
 * returned the wrong thing, ninety tests would go back to pending with CI green.
 */
import os from "os";
import path from "path";

import { expect } from "chai";

import { blue, dim, green, red, yellow } from "../../scripts/lib/log";
import { has, tryRun } from "../../scripts/lib/run";
import { strict } from "../helpers/artifacts";

describe("scripts/lib/run", () => {
    describe("has", () => {
        it("finds a tool that exists", () => {
            expect(has("node")).to.equal(true);
        });

        it("does not find one that does not", () => {
            expect(has("definitely-not-a-real-binary-xyzzy")).to.equal(false);
        });
    });

    describe("tryRun", () => {
        it("reports success and captures stdout", () => {
            const result = tryRun("node", ["-e", "console.log('hello')"]);
            expect(result.ok).to.equal(true);
            expect(result.stdout.trim()).to.equal("hello");
        });

        // The property the ported scripts depend on: a non-zero exit must be
        // visible. `full-pipeline.sh` lost exactly this by writing `|| echo`.
        it("reports failure rather than swallowing it", () => {
            const result = tryRun("node", ["-e", "process.exit(3)"]);
            expect(result.ok).to.equal(false);
        });

        it("captures stderr separately from stdout", () => {
            const result = tryRun("node", ["-e", "console.error('to stderr')"]);
            expect(result.stderr).to.include("to stderr");
            expect(result.stdout).to.equal("");
        });

        it("reports a missing binary as a failure, not a throw", () => {
            const result = tryRun("definitely-not-a-real-binary-xyzzy", []);
            expect(result.ok).to.equal(false);
        });

        it("runs from the repository root, not the caller's directory", () => {
            // circom resolves its circomlib includes as `../node_modules/...`,
            // so a script inheriting the caller's cwd fails to compile anything.
            // Three shell scripts had exactly that bug.
            //
            // Asserting against the root alone would pass trivially — mocha
            // already runs there — so the process is moved first.
            const root = path.resolve(__dirname, "..", "..");
            const original = process.cwd();

            try {
                process.chdir(os.tmpdir());
                const result = tryRun("node", ["-e", "console.log(process.cwd())"]);
                expect(result.stdout.trim()).to.equal(root);
            } finally {
                process.chdir(original);
            }
        });
    });
});

describe("scripts/lib/log", () => {
    // Colour is suppressed when stdout is not a TTY, which is the case under
    // mocha. That is the behaviour worth pinning: CI logs should not carry raw
    // escape sequences, which the two remaining shell scripts still emit.
    it("emits no escape sequences when stdout is not a TTY", () => {
        for (const wrap of [red, green, yellow, blue, dim]) {
            expect(wrap("plain")).to.equal("plain");
        }
    });

    it("every colour is a distinct function", () => {
        const fns = new Set([red, green, yellow, blue, dim]);
        expect(fns.size).to.equal(5);
    });
});

describe("test/helpers/artifacts", () => {
    const original = process.env.CIRCUITS_REQUIRE_ARTIFACTS;

    afterEach(() => {
        if (original === undefined) delete process.env.CIRCUITS_REQUIRE_ARTIFACTS;
        else process.env.CIRCUITS_REQUIRE_ARTIFACTS = original;
    });

    it("strict mode is off by default, so a fresh checkout stays green", () => {
        delete process.env.CIRCUITS_REQUIRE_ARTIFACTS;
        expect(strict()).to.equal(false);
    });

    it("strict mode is on when the variable is set", () => {
        process.env.CIRCUITS_REQUIRE_ARTIFACTS = "1";
        expect(strict()).to.equal(true);
    });

    // The variable's presence is what matters, not its value: CI sets "1", and
    // a developer might set "true". Both must work.
    it("any non-empty value enables it", () => {
        process.env.CIRCUITS_REQUIRE_ARTIFACTS = "true";
        expect(strict()).to.equal(true);
    });
});
