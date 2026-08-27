/**
 * Structural validation of the COMMITTED manifest.json.
 *
 * Releases are manual (docs/RELEASE.md) and CI never regenerates the manifest,
 * so this is the check CI can always run without artifacts or pack-verifying-key: the
 * committed manifest is well-formed, version-consistent with package.json, and
 * safe to serve from a flat directory (npm pkg/, R2).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "chai";

const ROOT = path.resolve(__dirname, "..");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const REQUIRED_ARTIFACTS = ["wasm", "zkey", "vk_json"];

describe("committed manifest.json is valid", () => {
    it("has the expected schema header", () => {
        expect(manifest.schema_version).to.equal("1.0.0");
        expect(manifest.package_name).to.equal("orbinum-circuits");
    });

    it("package_version matches package.json", () => {
        expect(manifest.package_version).to.equal(pkg.version);
    });

    it("has at least one circuit", () => {
        expect(Object.keys(manifest.circuits)).to.not.be.empty;
    });

    for (const [circuit, entry] of Object.entries<any>(manifest.circuits)) {
        describe(circuit, () => {
            it("active_version is in supported_versions", () => {
                expect(entry.supported_versions).to.include(entry.active_version);
            });

            it("versions keys equal supported_versions", () => {
                const keys = Object.keys(entry.versions)
                    .map(Number)
                    .sort((a, b) => a - b);
                const supported = [...entry.supported_versions].sort(
                    (a: number, b: number) => a - b
                );
                expect(keys).to.deep.equal(supported);
            });

            it("every version has required artifacts with valid hashes", () => {
                for (const [vStr, v] of Object.entries<any>(entry.versions)) {
                    expect(v.version, `${circuit} v${vStr} version field`).to.equal(Number(vStr));
                    expect(v.vk_hash, `${circuit} v${vStr} vk_hash`).to.match(/^0x[0-9a-f]{64}$/);
                    for (const kind of REQUIRED_ARTIFACTS) {
                        expect(v.artifacts[kind], `${circuit} v${vStr} missing ${kind}`).to.exist;
                    }
                    for (const [kind, a] of Object.entries<any>(v.artifacts)) {
                        const label = `${circuit} v${vStr} ${kind}`;
                        expect(a.file, label).to.be.a("string").and.not.be.empty;
                        expect(a.localPath, label).to.be.a("string").and.not.be.empty;
                        expect(a.bytes, label).to.be.a("number").and.be.greaterThan(0);
                        expect(a.sha256, label).to.match(/^[0-9a-f]{64}$/);
                    }
                }
            });

            it("vk_hashes are distinct across versions", () => {
                const hashes = Object.values<any>(entry.versions).map((v) => v.vk_hash);
                expect(new Set(hashes).size, `${circuit} duplicate vk_hash`).to.equal(
                    hashes.length
                );
            });
        });
    }

    it("artifact file names are unique across the whole manifest (flat serving dir)", () => {
        const seen = new Map<string, string>();
        for (const [circuit, entry] of Object.entries<any>(manifest.circuits)) {
            for (const [vStr, v] of Object.entries<any>(entry.versions)) {
                for (const [kind, a] of Object.entries<any>(v.artifacts)) {
                    const where = `${circuit} v${vStr} ${kind}`;
                    const prev = seen.get(a.file);
                    expect(prev, `duplicate file ${a.file}: ${prev} and ${where}`).to.equal(
                        undefined
                    );
                    seen.set(a.file, where);
                }
            }
        }
    });
});
