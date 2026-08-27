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
const PACK_VERIFYING_KEY_BIN =
    process.env.PACK_VERIFYING_KEY_BIN ??
    path.resolve(ROOT, "../groth16-proofs/target/release/pack-verifying-key");

const CIRCUITS = ["value_proof", "transfer", "unshield"] as const;

/** blake2_256 of the arkworks binary — must equal sp_io::hashing::blake2_256(key_data). */
function canonicalVkHash(vkJsonPath: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkhash-test-"));
    try {
        const bin = path.join(dir, "vk.bin");
        execFileSync(PACK_VERIFYING_KEY_BIN, [vkJsonPath, bin], { stdio: "pipe" });
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
    const hasBin = fs.existsSync(PACK_VERIFYING_KEY_BIN);

    /** vk.json for a version: the suffixed file if present, else the base (single-version) file. */
    function vkJsonForVersion(circuit: string, version: number): string {
        const suffixed = path.join(ROOT, "build", `verification_key_${circuit}_v${version}.json`);
        if (fs.existsSync(suffixed)) return suffixed;
        return path.join(ROOT, "build", `verification_key_${circuit}.json`);
    }

    for (const circuit of CIRCUITS) {
        it(`${circuit}: every version's manifest vk_hash == blake2_256(arkworks VK)`, function () {
            if (!hasManifest || !hasBin) {
                this.skip(); // needs a built manifest + pack-verifying-key binary
                return;
            }
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const entry = manifest.circuits[circuit];
            if (!entry) {
                this.skip(); // circuit not in this manifest build
                return;
            }

            // Check EVERY registered version, not just the active one — a rotation
            // adds v2 while keeping v1, and both hashes must match the chain.
            let checked = 0;
            for (const vStr of Object.keys(entry.versions)) {
                const version = Number(vStr);
                const manifestHash: string = entry.versions[vStr].vk_hash;
                const vkJson = vkJsonForVersion(circuit, version);
                if (!fs.existsSync(vkJson)) continue; // version's source not on disk here
                expect(manifestHash, `${circuit} v${version}`).to.equal(canonicalVkHash(vkJson));
                expect(manifestHash).to.match(/^0x[0-9a-f]{64}$/);
                checked++;
            }
            if (checked === 0) this.skip();
        });
    }
});
