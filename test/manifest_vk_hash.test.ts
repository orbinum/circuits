/**
 * Anti-regression lock for the per-note VK-versioning cross-check.
 *
 * The SDK's CircuitVersionResolver refuses to spend a note unless the prover's
 * VK hash (from manifest.json) equals the chain's VK hash. The chain computes
 * `blake2_256(key_data)` where `key_data` is the arkworks-compressed VK binary
 * (node/frame/zk-verifier/src/runtime_api.rs). If the manifest ever publishes a
 * different hash (e.g. sha256 of vk.json — the original bug), the cross-check
 * can NEVER pass with real artifacts and every note becomes unspendable after a
 * rotation. This test recomputes the canonical hash independently and asserts
 * the manifest matches.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { blake2b } from "@noble/hashes/blake2.js";
import { expect } from "chai";

const ROOT = path.resolve(__dirname, "..");
const CONVERT_VK_BIN =
    process.env.CONVERT_VK_BIN ?? path.resolve(ROOT, "../groth16-proofs/target/release/convert-vk");

const CIRCUITS = ["value_proof", "transfer", "unshield", "private_link"] as const;

/** blake2_256 of the arkworks binary — must equal sp_io::hashing::blake2_256(key_data). */
function canonicalVkHash(vkJsonPath: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkhash-test-"));
    try {
        const bin = path.join(dir, "vk.bin");
        execFileSync(CONVERT_VK_BIN, [vkJsonPath, bin], { stdio: "pipe" });
        const digest = blake2b(new Uint8Array(fs.readFileSync(bin)), { dkLen: 32 });
        return `0x${Buffer.from(digest).toString("hex")}`;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("manifest vk_hash is the canonical on-chain blake2_256", () => {
    it("noble blake2b-256 matches the substrate blake2_256 test vector", () => {
        // sp_io::hashing::blake2_256(b"abc")
        const h = blake2b(new TextEncoder().encode("abc"), { dkLen: 32 });
        expect("0x" + Buffer.from(h).toString("hex")).to.equal(
            "0xbddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319"
        );
    });

    const manifestPath = path.join(ROOT, "manifest.json");
    const hasManifest = fs.existsSync(manifestPath);
    const hasBin = fs.existsSync(CONVERT_VK_BIN);

    for (const circuit of CIRCUITS) {
        it(`${circuit}: manifest vk_hash == blake2_256(arkworks VK)`, function () {
            if (!hasManifest || !hasBin) {
                this.skip(); // needs a built manifest + convert-vk binary
                return;
            }
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const entry = manifest.circuits[circuit];
            if (!entry) {
                this.skip(); // circuit not in this manifest build
                return;
            }
            const version = String(entry.active_version);
            const manifestHash: string = entry.versions[version].vk_hash;

            const vkJson = path.join(ROOT, "build", `verification_key_${circuit}.json`);
            if (!fs.existsSync(vkJson)) {
                this.skip();
                return;
            }
            const expected = canonicalVkHash(vkJson);

            expect(manifestHash).to.equal(expected);
            // Defense: must be a 32-byte hex hash, never empty/sha256-of-json shape slipping through.
            expect(manifestHash).to.match(/^0x[0-9a-f]{64}$/);
        });
    }
});
