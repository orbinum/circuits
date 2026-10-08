/**
 * The trusted setup's two guards: the ceremony file is the Hermez one, byte for
 * byte, and a release ceremony never runs on development defaults.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { expect } from "chai";

import { ceremonyConfig, isHermezPtau } from "../../scripts/build/setup";

describe("scripts/build/setup", () => {
    describe("isHermezPtau", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ptau-test-"));
        const file = path.join(tmp, "not-a-ptau");
        fs.writeFileSync(file, "<html>Access Denied</html>");

        after(() => fs.rmSync(tmp, { recursive: true, force: true }));

        it("refuses a file that is not the ceremony file, whatever its name", () => {
            expect(isHermezPtau(file)).to.equal(false);
        });

        it("accepts a file whose blake2b-512 is the expected one", () => {
            const hash = crypto
                .createHash("blake2b512")
                .update(fs.readFileSync(file))
                .digest("hex");
            expect(isHermezPtau(file, hash)).to.equal(true);
        });
    });

    describe("ceremonyConfig", () => {
        const beacon = "4a194296be34a87bdb073fa8f678380d3e45c790ffca9fc0ce94de2ec0568ed8";

        it("falls back to development values and says so", () => {
            const c = ceremonyConfig({});
            expect(c.dev).to.equal(true);
            expect(c.entropy).to.be.a("string").that.is.not.empty;
            expect(c.beaconIters).to.equal("10");
        });

        it("is not a development ceremony once both values are explicit", () => {
            const c = ceremonyConfig({ SETUP_ENTROPY: "x", SETUP_BEACON: `0x${beacon}` });
            expect(c.dev).to.equal(false);
            expect(c.beacon).to.equal(beacon);
        });

        it("a release ceremony refuses development defaults", () => {
            expect(() => ceremonyConfig({ SETUP_CEREMONY: "release" })).to.throw(/SETUP_ENTROPY/);
            expect(() =>
                ceremonyConfig({ SETUP_CEREMONY: "release", SETUP_ENTROPY: "x" })
            ).to.throw(/SETUP_BEACON/);
        });

        it("a release ceremony needs a 32-byte hex beacon", () => {
            const release = (b: string) =>
                ceremonyConfig({ SETUP_CEREMONY: "release", SETUP_ENTROPY: "x", SETUP_BEACON: b });
            expect(() => release("0102")).to.throw(/32-byte/);
            expect(() => release("not-hex".repeat(10))).to.throw(/32-byte/);
            expect(release(beacon).beacon).to.equal(beacon);
        });
    });
});
