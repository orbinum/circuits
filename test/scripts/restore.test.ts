/**
 * `release:restore` writes a published artifact only when its bytes are the
 * ones the committed manifest records, and never outside the repository.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { expect } from "chai";

import type { Manifest } from "../../scripts/lib/manifest";
import { restore } from "../../scripts/release/restore-artifacts";

const sha = (data: string): string => crypto.createHash("sha256").update(data).digest("hex");

/** A manifest with one shield v2 zkey; v2 is not what the source builds, so it is always restorable. */
function manifest(file: string, localPath: string, content: string): Manifest {
    return {
        schema_version: "1.0.0",
        package_name: "orbinum-circuits",
        package_version: "0.0.0",
        generated_at: "",
        circuits: {
            shield: {
                active_version: 1,
                supported_versions: [1, 2],
                versions: {
                    "2": {
                        version: 2,
                        vk_hash: "0x00",
                        artifacts: {
                            zkey: {
                                file,
                                localPath,
                                bytes: content.length,
                                sha256: sha(content),
                            },
                        },
                    },
                },
            },
        },
    } as unknown as Manifest;
}

describe("scripts/release/restore-artifacts", () => {
    let root: string;
    let pkg: string;

    beforeEach(() => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "restore-test-"));
        root = path.join(tmp, "repo");
        pkg = path.join(tmp, "package");
        fs.mkdirSync(root);
        fs.mkdirSync(pkg);
    });

    afterEach(() => fs.rmSync(path.dirname(root), { recursive: true, force: true }));

    it("writes a published artifact whose sha256 matches the manifest", () => {
        fs.writeFileSync(path.join(pkg, "k.zkey"), "good");
        const r = restore(manifest("k.zkey", "keys/k.zkey", "good"), pkg, { root });
        expect(r.errors).to.deep.equal([]);
        expect(r.written).to.deep.equal(["keys/k.zkey"]);
        expect(fs.readFileSync(path.join(root, "keys/k.zkey"), "utf8")).to.equal("good");
    });

    it("refuses a published artifact whose bytes differ, and writes nothing", () => {
        fs.writeFileSync(path.join(pkg, "k.zkey"), "tampered");
        const r = restore(manifest("k.zkey", "keys/k.zkey", "good"), pkg, { root });
        expect(r.written).to.deep.equal([]);
        expect(r.errors[0]).to.include("published sha256");
        expect(fs.existsSync(path.join(root, "keys/k.zkey"))).to.equal(false);
    });

    it("reports an artifact missing from the package", () => {
        const r = restore(manifest("k.zkey", "keys/k.zkey", "good"), pkg, { root });
        expect(r.errors[0]).to.include("not in the published package");
    });

    it("leaves a local file that already matches untouched", () => {
        fs.mkdirSync(path.join(root, "keys"));
        fs.writeFileSync(path.join(root, "keys/k.zkey"), "good");
        const r = restore(manifest("k.zkey", "keys/k.zkey", "good"), pkg, { root });
        expect(r.canonical).to.equal(1);
        expect(r.written).to.deep.equal([]);
    });

    it("replaces a drifted local file with the published one", () => {
        fs.mkdirSync(path.join(root, "keys"));
        fs.writeFileSync(path.join(root, "keys/k.zkey"), "drifted");
        fs.writeFileSync(path.join(pkg, "k.zkey"), "good");
        const r = restore(manifest("k.zkey", "keys/k.zkey", "good"), pkg, { root });
        expect(r.written).to.deep.equal(["keys/k.zkey"]);
        expect(fs.readFileSync(path.join(root, "keys/k.zkey"), "utf8")).to.equal("good");
    });

    it("never writes outside the repository or reads outside the package", () => {
        fs.writeFileSync(path.join(pkg, "k.zkey"), "good");
        const outside = restore(manifest("k.zkey", "../escape.zkey", "good"), pkg, { root });
        expect(outside.errors[0]).to.include("escapes");
        expect(fs.existsSync(path.join(path.dirname(root), "escape.zkey"))).to.equal(false);

        const traversal = restore(manifest("../secret", "keys/k.zkey", "good"), pkg, { root });
        expect(traversal.errors[0]).to.include("escapes");
    });
});
