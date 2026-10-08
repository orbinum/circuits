/**
 * The circom linter fails on what matters: an unconstrained assignment, and a
 * signal that `--inspect` finds outside every constraint.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

import { expect } from "chai";

import { ROOT } from "../../scripts/lib/paths";
import { has } from "../../scripts/lib/run";

const LINT = path.join(ROOT, "scripts", "utils", "lint-circom.ts");

function lint(file: string): { status: number | null; output: string } {
    const r = spawnSync("npx", ["ts-node", LINT, file], { cwd: ROOT, encoding: "utf8" });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

describe("scripts/utils/lint-circom", function () {
    this.timeout(120_000);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lint-test-"));
    after(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it("fails on an unconstrained assignment", () => {
        const file = path.join(tmp, "unconstrained.circom");
        fs.writeFileSync(
            file,
            "pragma circom 2.0.0;\ntemplate T() { signal input a; signal output b; b <-- a * 2; }\ncomponent main = T();\n"
        );
        const { status, output } = lint(file);
        expect(status, output).to.not.equal(0);
        expect(output).to.include("unconstrained assignment");
    });

    it("fails on a signal no constraint touches", function () {
        if (!has("circom")) return this.skip();
        const file = path.join(tmp, "free.circom");
        fs.writeFileSync(
            file,
            "pragma circom 2.0.0;\ntemplate T() { signal input a; signal input free; signal output b; b <== a * a; }\ncomponent main = T();\n"
        );
        const { status, output } = lint(file);
        expect(status, output).to.not.equal(0);
        expect(output).to.include("unconstrained signal");
    });

    it("passes a circuit that binds every signal", function () {
        if (!has("circom")) return this.skip();
        const file = path.join(tmp, "bound.circom");
        fs.writeFileSync(
            file,
            "pragma circom 2.0.0;\ntemplate T() { signal input a; signal output b; b <== a * a; }\ncomponent main = T();\n"
        );
        const { status, output } = lint(file);
        expect(status, output).to.equal(0);
    });
});
