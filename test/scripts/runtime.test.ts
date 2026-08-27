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
import fs from "fs";
import os from "os";
import path from "path";

import { expect } from "chai";

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

    describe("run", () => {
        // `run` is what every build script uses, and its contract is the one the
        // whole TypeScript port was justified by: a non-zero exit must stop the
        // build. `tryRun` cannot stand in for it — that one returns failures,
        // this one exits on them, and they share only their spawnSync setup.
        //
        // Exercised in a child process because `die()` calls `process.exit(1)`,
        // which would take the test runner with it.
        const inChild = (body: string) =>
            tryRun("npx", ["ts-node", "-e", `import { run } from "./scripts/lib/run";\n${body}`]);

        it("returns captured stdout on success", () => {
            const result = inChild(
                `process.stdout.write(run("node", ["-e", "console.log('ok')"], { capture: true }));`
            );
            expect(result.ok, result.stderr).to.equal(true);
            expect(result.stdout.trim()).to.equal("ok");
        });

        it("exits non-zero when the command fails", () => {
            const result = inChild(`run("node", ["-e", "process.exit(3)"]);`);
            expect(result.ok, "a failing command did not stop the script").to.equal(false);
            expect(result.status).to.equal(1);
        });

        it("names the command and its exit code in the failure", () => {
            const result = inChild(`run("node", ["-e", "process.exit(7)"]);`);
            expect(`${result.stdout}${result.stderr}`).to.include("exited 7");
        });

        it("surfaces the captured output when a captured command fails", () => {
            // The reason `capture` is used for the quiet snarkjs calls: silent
            // on success, but the diagnostic survives a failure. `setup.sh`
            // redirected to /dev/null and lost it.
            const result = inChild(
                `run("node", ["-e", "console.error('the real reason'); process.exit(1)"], { capture: true });`
            );
            expect(result.ok).to.equal(false);
            expect(`${result.stdout}${result.stderr}`).to.include("the real reason");
        });

        it("exits when the command does not exist", () => {
            const result = inChild(`run("definitely-not-a-real-binary-xyzzy", []);`);
            expect(result.ok).to.equal(false);
            expect(`${result.stdout}${result.stderr}`).to.match(/could not be started|exited/);
        });

        it("writes input to the child's stdin", () => {
            // The trusted setup pipes entropy this way rather than passing it as
            // an argument, where it would be visible in the process table.
            const result = inChild(
                `process.stdout.write(run("cat", [], { capture: true, input: "piped-entropy" }));`
            );
            expect(result.ok, result.stderr).to.equal(true);
            expect(result.stdout).to.equal("piped-entropy");
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
    // `useColor` is decided once at import from `process.stdout.isTTY`, which is
    // false under mocha — so asserting that the wrappers return their input
    // here would be comparing a string to itself. What can be checked without a
    // TTY is that the escape codes are distinct and well-formed, which is what
    // a miscopied colour block gets wrong: `compile.sh` referenced a `BLUE` it
    // never defined, and four lines printed uncoloured for as long as the file
    // existed.
    it("every colour has a distinct, well-formed escape code", () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, "..", "..", "scripts", "lib", "log.ts"),
            "utf8"
        );
        const codes = [...source.matchAll(/wrap\("([\d;]+)"\)/g)].map((m) => m[1]);

        expect(codes.length, "expected five colour wrappers").to.equal(5);
        expect(new Set(codes).size, "two colours share an escape code").to.equal(codes.length);
        for (const code of codes) {
            expect(code).to.match(/^\d+(;\d+)?$/);
        }
    });

    it("suppresses colour when stdout is not a TTY", () => {
        // Re-imported in a child with a pipe for stdout, which is the condition
        // CI runs under. Asserting it in-process would pass trivially.
        const probe = tryRun("npx", [
            "ts-node",
            "-e",
            `import { green } from "./scripts/lib/log"; process.stdout.write(green("x"));`,
        ]);
        expect(probe.ok, probe.stderr).to.equal(true);
        expect(probe.stdout, "escape sequences leaked into a piped stream").to.equal("x");
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
