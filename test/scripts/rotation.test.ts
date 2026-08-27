/**
 * Manifest rotation — adding a second version of one circuit.
 *
 * A key is rotated when a circuit's trusted setup is redone: the old verifying
 * key stays registered so proofs already in flight keep verifying, and the new
 * one becomes active. The manifest is what records both, and
 * `generate-manifest.ts` is the only code that writes it.
 *
 * That branch had no test. It is also the only code that produces
 * `supported_versions` with more than one element, the only producer of
 * `_v{n}`-suffixed artifact names, and the only place a `vk_hash` the chain will
 * register is computed for a version other than the first. Three properties
 * that exist solely on a path nothing exercised.
 *
 * The test builds its own suffixed artifacts by copying the v1 ones. That makes
 * the two versions share a `vk_hash`, which a real rotation never would — but
 * the property under test is the *merge*: that prior versions survive verbatim,
 * that the new one is appended, and that `active_version` moves. A real
 * ceremony is not needed to check any of those, and requiring one would mean
 * the test only ran where a spare `.zkey` happened to be lying around.
 */
import { execFileSync } from "child_process";
import fs from "fs";

import { expect } from "chai";

import { MANIFEST_PATH, ROOT, artifacts } from "../../scripts/lib/paths";
import { readManifest, type Manifest } from "../../scripts/lib/manifest";
import { packVerifyingKeyBin } from "../../scripts/lib/vk-hash";

/** Run generate-manifest with the given environment. */
function generate(env: NodeJS.ProcessEnv): { ok: boolean; output: string } {
    try {
        const out = execFileSync("npx", ["ts-node", "scripts/utils/generate-manifest.ts"], {
            cwd: ROOT,
            env: { ...process.env, ...env },
            encoding: "utf8",
            stdio: "pipe",
        });
        return { ok: true, output: out };
    } catch (err) {
        const e = err as { stdout?: string; stderr?: string };
        return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
}

describe("Manifest rotation", function () {
    this.timeout(120_000);

    const CIRCUIT = "unshield";
    const VERSION = 2;

    /** The suffixed artifacts this test creates, removed afterwards. */
    let created: string[] = [];
    let original: string | null = null;

    before(function () {
        // generate-manifest computes a vk_hash for every version, which shells out
        // to pack-verifying-key. Without it the script dies before writing
        // anything, so there is no rotation to assert on.
        if (!fs.existsSync(packVerifyingKeyBin())) {
            if (process.env.CIRCUITS_REQUIRE_ARTIFACTS) {
                throw new Error(
                    "pack-verifying-key is required to exercise rotation and " +
                        "CIRCUITS_REQUIRE_ARTIFACTS is set — set PACK_VERIFYING_KEY_BIN"
                );
            }
            return this.skip();
        }

        const v1 = artifacts(CIRCUIT);
        const v2 = artifacts(CIRCUIT, `_v${VERSION}`);

        // Rotation needs wasm, zkey and vk_json under the suffixed names. Copied
        // from v1 rather than generated: see the header.
        const pairs: [string, string][] = [
            [v1.wasm, v2.wasm],
            [v1.zkey, v2.zkey],
            [v1.vkJson, v2.vkJson],
        ];

        if (!pairs.every(([src]) => fs.existsSync(src))) {
            if (process.env.CIRCUITS_REQUIRE_ARTIFACTS) {
                throw new Error(
                    `${CIRCUIT} artifacts are missing and CIRCUITS_REQUIRE_ARTIFACTS is set — ` +
                        `run 'pnpm build-all' first`
                );
            }
            return this.skip();
        }

        original = fs.readFileSync(MANIFEST_PATH, "utf8");
        for (const [src, dest] of pairs) {
            fs.copyFileSync(src, dest);
            created.push(dest);
        }
    });

    after(function () {
        for (const file of created) {
            fs.rmSync(file, { force: true });
        }
        created = [];
        // The manifest is committed; a test must not leave it rewritten.
        if (original !== null) {
            fs.writeFileSync(MANIFEST_PATH, original);
        }
    });

    it("appends the new version and keeps the prior one verbatim", function () {
        const before = readManifest();
        const priorV1 = before.circuits[CIRCUIT].versions["1"];

        const result = generate({
            ROTATE_CIRCUIT: CIRCUIT,
            ROTATE_VERSION: String(VERSION),
        });
        expect(result.ok, result.output).to.equal(true);

        const after: Manifest = readManifest();
        const entry = after.circuits[CIRCUIT];

        expect(Object.keys(entry.versions).sort()).to.deep.equal(["1", "2"]);
        expect(entry.supported_versions).to.deep.equal([1, 2]);
        expect(entry.active_version, "the new version becomes active").to.equal(VERSION);

        // The prior version's bytes are already published and immutable. If
        // regenerating changed them, every proof against v1 would stop
        // verifying — so this is the assertion that matters most here.
        expect(entry.versions["1"], "the published v1 entry was rewritten").to.deep.equal(priorV1);
    });

    it("names the new version's artifacts with the version suffix", function () {
        generate({ ROTATE_CIRCUIT: CIRCUIT, ROTATE_VERSION: String(VERSION) });

        const v2 = readManifest().circuits[CIRCUIT].versions["2"];
        // Suffixed names are required: the npm package serves every artifact
        // from one flat directory, so v1 and v2 would overwrite each other.
        for (const artifact of Object.values(v2.artifacts)) {
            expect(artifact?.file, `${artifact?.file} is not version-suffixed`).to.include(
                `_v${VERSION}`
            );
        }
        expect(v2.version).to.equal(VERSION);
        expect(v2.vk_hash).to.match(/^0x[0-9a-f]{64}$/);
    });

    it("leaves the other circuits untouched", function () {
        const before = readManifest();
        generate({ ROTATE_CIRCUIT: CIRCUIT, ROTATE_VERSION: String(VERSION) });
        const after = readManifest();

        for (const other of Object.keys(after.circuits)) {
            if (other === CIRCUIT) continue;
            expect(
                after.circuits[other],
                `${other} changed during an unshield rotation`
            ).to.deep.equal(before.circuits[other]);
        }
    });

    it("without the env vars, every circuit has exactly one version", function () {
        const result = generate({ ROTATE_CIRCUIT: "", ROTATE_VERSION: "" });
        expect(result.ok, result.output).to.equal(true);

        for (const [circuit, entry] of Object.entries(readManifest().circuits)) {
            expect(
                Object.keys(entry.versions),
                `${circuit} rotated without being asked`
            ).to.have.length(1);
            expect(entry.active_version).to.equal(1);
        }
    });

    describe("bad input is refused rather than silently ignored", () => {
        it("a misspelled circuit name fails", function () {
            const result = generate({ ROTATE_CIRCUIT: "unshiled", ROTATE_VERSION: "2" });
            expect(result.ok, "a typo fell through to the default path").to.equal(false);
            expect(result.output).to.include("unknown circuit");
        });

        it("a missing version fails", function () {
            const result = generate({ ROTATE_CIRCUIT: CIRCUIT, ROTATE_VERSION: "" });
            expect(result.ok).to.equal(false);
            expect(result.output).to.include("ROTATE_VERSION");
        });

        it("a non-positive version fails", function () {
            const result = generate({ ROTATE_CIRCUIT: CIRCUIT, ROTATE_VERSION: "0" });
            expect(result.ok).to.equal(false);
            expect(result.output).to.include("ROTATE_VERSION");
        });
    });
});
