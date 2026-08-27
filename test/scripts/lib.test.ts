/**
 * The shared script library.
 *
 * These modules are what the build pipeline is made of — path resolution, the
 * circuit list, manifest traversal — and none of it had a test. That mattered
 * because the code they replaced was duplicated across seven shell scripts and
 * four TypeScript ones, and the copies had already drifted: `compile.sh`
 * referenced a colour it never defined, and the repository root was derived in
 * three different spellings.
 *
 * Consolidating removed the drift. These tests are what stop it coming back.
 */
import fs from "fs";
import path from "path";

import { expect } from "chai";

import {
    CIRCUITS,
    PUBLIC_SIGNALS,
    isCircuit,
    parseCircuit,
    scriptName,
} from "../../scripts/lib/circuits";
import { ROOT, artifacts, circuitSource, fixtures, rel } from "../../scripts/lib/paths";
import {
    allArtifacts,
    checkArtifact,
    readManifest,
    sha256Hex,
    verifyAll,
} from "../../scripts/lib/manifest";

describe("scripts/lib/circuits", () => {
    it("every circuit has a source file", () => {
        for (const circuit of CIRCUITS) {
            expect(
                fs.existsSync(circuitSource(circuit)),
                `circuits/${circuit}.circom does not exist`
            ).to.equal(true);
        }
    });

    it("every circuit has a declared public-signal count", () => {
        for (const circuit of CIRCUITS) {
            expect(PUBLIC_SIGNALS).to.have.property(circuit);
            expect(PUBLIC_SIGNALS[circuit]).to.be.greaterThan(0);
        }
    });

    describe("name spellings", () => {
        // A circuit is `value_proof` on disk and `value-proof` in a script
        // name. Both must reach the same circuit, because both appear in the
        // documentation and in muscle memory.
        it("accepts the on-disk spelling", () => {
            expect(parseCircuit("value_proof")).to.equal("value_proof");
        });

        it("accepts the script spelling", () => {
            expect(parseCircuit("value-proof")).to.equal("value_proof");
        });

        it("round-trips through scriptName", () => {
            for (const circuit of CIRCUITS) {
                expect(parseCircuit(scriptName(circuit))).to.equal(circuit);
            }
        });

        it("rejects an unknown name, listing the valid ones", () => {
            expect(() => parseCircuit("nope")).to.throw(/unknown circuit "nope"/);
            expect(() => parseCircuit("nope")).to.throw(/value_proof/);
        });

        it("isCircuit narrows correctly", () => {
            expect(isCircuit("transfer")).to.equal(true);
            expect(isCircuit("transfer_v2")).to.equal(false);
            expect(isCircuit("")).to.equal(false);
        });
    });
});

describe("scripts/lib/paths", () => {
    it("resolves the repository root regardless of the caller's cwd", () => {
        // The failure this catches: three shell scripts assumed the cwd was
        // already the root and broke when invoked from anywhere else.
        expect(fs.existsSync(path.join(ROOT, "package.json"))).to.equal(true);
        expect(fs.existsSync(path.join(ROOT, "circuits"))).to.equal(true);
    });

    it("artifact paths follow the published naming", () => {
        const a = artifacts("unshield");
        expect(a.zkey.endsWith("keys/unshield_pk.zkey")).to.equal(true);
        expect(a.ark.endsWith("keys/unshield_pk.ark")).to.equal(true);
        expect(a.wasm.endsWith("build/unshield_js/unshield.wasm")).to.equal(true);
        expect(a.vkJson.endsWith("build/verification_key_unshield.json")).to.equal(true);
    });

    it("a version suffix keeps two versions from colliding", () => {
        // Suffixed names are required for any non-base version: the npm package
        // serves every artifact from one flat directory, so v1 and v2 would
        // overwrite each other without this.
        const v2 = artifacts("unshield", "_v2");
        expect(v2.zkey.endsWith("keys/unshield_v2_pk.zkey")).to.equal(true);
        expect(v2.vkJson.endsWith("build/verification_key_unshield_v2.json")).to.equal(true);
        // The wasm lives in the unsuffixed directory but takes the suffixed name.
        expect(v2.wasm.endsWith("build/unshield_js/unshield_v2.wasm")).to.equal(true);
    });

    it("fixture paths match what make-fixture writes", () => {
        const f = fixtures("transfer");
        expect(f.input.endsWith("fixtures/transfer.input.json")).to.equal(true);
        expect(f.wtns.endsWith("fixtures/transfer.wtns")).to.equal(true);
    });

    it("rel() produces paths relative to the root", () => {
        expect(rel(path.join(ROOT, "circuits", "note.circom"))).to.equal("circuits/note.circom");
    });
});

/**
 * Skip a case that needs built artifacts — or fail, under strict mode.
 *
 * A bare `return` reports as a pass, which makes an absent artifact
 * indistinguishable from a working assertion. That is the failure
 * `CIRCUITS_REQUIRE_ARTIFACTS` exists to catch, and it has to be consulted here
 * too, not only in the circuit suites.
 */
function skipWithoutArtifacts(ctx: Mocha.Context): never {
    if (process.env.CIRCUITS_REQUIRE_ARTIFACTS) {
        throw new Error(
            "manifest artifacts are missing and CIRCUITS_REQUIRE_ARTIFACTS is set — " +
                "run 'pnpm build-all' first"
        );
    }
    ctx.skip();
}

describe("scripts/lib/manifest", () => {
    it("sha256Hex matches a known vector", () => {
        // The empty string, from FIPS 180-4.
        expect(sha256Hex(Buffer.alloc(0))).to.equal(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    });

    it("allArtifacts flattens circuit → version → artifact", () => {
        const manifest = readManifest();
        const refs = allArtifacts(manifest);

        expect(refs.length).to.be.greaterThan(0);
        for (const ref of refs) {
            expect(ref.label).to.match(/^\w+ v\d+ \w+$/);
            expect(path.isAbsolute(ref.absolute)).to.equal(true);
            expect(ref.artifact.sha256).to.match(/^[0-9a-f]{64}$/);
            expect(ref.artifact.bytes).to.be.greaterThan(0);
        }
    });

    it("covers every circuit the manifest declares", () => {
        const manifest = readManifest();
        const seen = new Set(allArtifacts(manifest).map((r) => r.circuit));
        expect([...seen].sort()).to.deep.equal(Object.keys(manifest.circuits).sort());
    });

    it("checkArtifact reports a size mismatch rather than passing it", function () {
        const manifest = readManifest();
        const [ref] = allArtifacts(manifest);
        if (!fs.existsSync(ref.absolute)) return skipWithoutArtifacts(this);

        const tampered = { ...ref, artifact: { ...ref.artifact, bytes: ref.artifact.bytes + 1 } };
        const problem = checkArtifact(tampered);
        expect(problem, "a wrong byte count was accepted").to.be.a("string");
        expect(problem).to.include("size");
    });

    it("checkArtifact reports a hash mismatch", function () {
        const manifest = readManifest();
        const [ref] = allArtifacts(manifest);
        if (!fs.existsSync(ref.absolute)) return skipWithoutArtifacts(this);

        // The declared size is taken from the file rather than the manifest so
        // this stays a test of the *hash* branch. checkArtifact reports size
        // before hash, so on a commit that changes a circuit — where the wasm
        // legitimately differs from the published one — the manifest's size would
        // mismatch first and this would fail for an unrelated reason.
        const tampered = {
            ...ref,
            artifact: {
                ...ref.artifact,
                bytes: fs.statSync(ref.absolute).size,
                sha256: "0".repeat(64),
            },
        };
        expect(checkArtifact(tampered)).to.include("sha256 mismatch");
    });

    it("checkArtifact reports a missing file", () => {
        const manifest = readManifest();
        const [ref] = allArtifacts(manifest);
        const missing = {
            ...ref,
            absolute: path.join(ROOT, "does-not-exist.bin"),
            artifact: { ...ref.artifact, localPath: "does-not-exist.bin" },
        };
        expect(checkArtifact(missing)).to.include("MISSING");
    });

    it("verifyAll agrees with the committed manifest", function () {
        const manifest = readManifest();
        const present = allArtifacts(manifest).filter((r) => fs.existsSync(r.absolute));
        if (present.length === 0) {
            if (process.env.CIRCUITS_REQUIRE_ARTIFACTS) {
                throw new Error("no manifest artifacts on disk — run 'pnpm build-all' first");
            }
            return this.skip();
        }
        expect(verifyAll(manifest)).to.deep.equal(
            [],
            "the tree disagrees with the committed manifest. A wasm or r1cs mismatch " +
                "means a .circom changed without the manifest being regenerated — run " +
                "'pnpm run manifest'. A zkey, vk_json or ark mismatch means a ceremony " +
                "artifact drifted, which 'pnpm run release:restore' pulls back."
        );
    });
});
