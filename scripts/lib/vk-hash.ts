/**
 * The canonical verifying-key hash — how the chain identifies a key.
 *
 * `vk_hash` is `blake2_256` of the **arkworks-compressed binary**, byte for
 * byte what `sp_io::hashing::blake2_256(key_data)` computes on-chain. Hashing
 * `verification_key.json` instead would be a different hash of different bytes
 * and would never match, so this fails closed when the converter is missing
 * rather than falling back to something that looks plausible.
 *
 * The conversion is done by `pack-verifying-key` from the sibling
 * `groth16-proofs` checkout, which owns the byte format. Keeping the writer and
 * the reader in one repository is what stops the two drifting.
 *
 * `test/manifest_vk_hash.test.ts` deliberately keeps its own copy of this
 * computation rather than importing it. Verifying a value with the code that
 * produced it verifies nothing; the test is an independent second opinion, and
 * that is worth the duplication.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { blake2b } from "@noble/hashes/blake2.js";

import { ROOT } from "./paths";

/** Where the converter lives, overridable for CI and for a non-standard layout. */
export const packVerifyingKeyBin = (): string =>
    process.env.PACK_VERIFYING_KEY_BIN ??
    path.resolve(ROOT, "../groth16-proofs/target/release/pack-verifying-key");

/**
 * `blake2_256(pack-verifying-key(vk.json))`, as `0x`-prefixed hex.
 *
 * Throws if the converter is absent: a manifest with a guessed `vk_hash` would
 * register a key the chain cannot match, and no proof against it would ever
 * verify.
 */
export function computeVkHash(vkJsonPath: string): string {
    const bin = packVerifyingKeyBin();
    if (!fs.existsSync(bin)) {
        throw new Error(
            `pack-verifying-key binary not found at ${bin}. ` +
                `Build it (cargo build --release -p groth16-proofs --bin pack-verifying-key) ` +
                `or set PACK_VERIFYING_KEY_BIN.`
        );
    }

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "vkhash-"));
    const packed = path.join(scratch, "vk.bin");
    try {
        execFileSync(bin, [vkJsonPath, packed], { stdio: "pipe" });
        const digest = blake2b(new Uint8Array(fs.readFileSync(packed)), { dkLen: 32 });
        return `0x${Buffer.from(digest).toString("hex")}`;
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}
