#!/usr/bin/env ts-node
/**
 * Convert a `.zkey` into the `.ark` v2 artifact the arkworks prover reads.
 *
 * The conversion itself lives in the sibling `groth16-proofs` checkout, which
 * owns the format: a `.ark` v2 carries the proving key *and* the circuit's
 * constraint matrices, because proving a Circom circuit needs both. Keeping the
 * writer beside the reader is what stops the two drifting — a `.ark` v1 held
 * only the key, so every one this package published could be downloaded,
 * checksum-verified, and still not produce a proof.
 *
 * The binary was `convert-vk`'s counterpart `convert-to-ark` before
 * groth16-proofs 3.1.0 and `pack-proving-key` after. Both spellings are
 * accepted so this keeps working across the rename.
 *
 * Usage:
 *   ts-node scripts/build/pack-proving-key.ts <circuit>
 *
 * Environment:
 *   GROTH16_PROOFS_DIR    the checkout to build from (default: ../groth16-proofs)
 *   PACK_PROVING_KEY_BIN  an already-built binary, skipping the checkout entirely
 */
import fs from "fs";
import path from "path";

import { ROOT, artifacts, rel } from "../lib/paths";
import { banner, cli, die, info, ok, step } from "../lib/log";
import { parseCircuit } from "../lib/circuits";
import { has, run } from "../lib/run";

/**
 * Whether `converter()` could produce a binary, without building anything.
 *
 * `converter()` resolves three ways — an explicit binary, a pre-built one in
 * the checkout, or a `cargo build` — so "can we pack?" is not answerable by
 * probing for cargo alone. CI has Rust but no sibling checkout, which is
 * exactly the case a cargo probe gets wrong.
 */
export function canPack(): boolean {
    const explicit = process.env.PACK_PROVING_KEY_BIN;
    if (explicit) return fs.existsSync(explicit);

    const checkout = process.env.GROTH16_PROOFS_DIR ?? path.join(ROOT, "..", "groth16-proofs");
    if (fs.existsSync(path.join(checkout, "target", "release", "pack-proving-key"))) return true;
    return fs.existsSync(checkout) && has("cargo");
}

/** Where the converter is, building it if a checkout is available. */
function converter(): string {
    const explicit = process.env.PACK_PROVING_KEY_BIN;
    if (explicit) {
        if (!fs.existsSync(explicit)) {
            die(`PACK_PROVING_KEY_BIN is set to ${explicit}, which does not exist`);
        }
        return explicit;
    }

    const checkout = process.env.GROTH16_PROOFS_DIR ?? path.join(ROOT, "..", "groth16-proofs");
    const built = path.join(checkout, "target", "release", "pack-proving-key");
    if (fs.existsSync(built)) return built;

    if (!fs.existsSync(checkout)) {
        die(
            `groth16-proofs checkout not found at ${checkout}.\n` +
                `  Clone it beside this repository, or set GROTH16_PROOFS_DIR, ` +
                `or point PACK_PROVING_KEY_BIN at an existing binary.`
        );
    }
    if (!has("cargo")) {
        die("cargo not found, so the converter cannot be built. Install Rust: https://rustup.rs");
    }

    step("  building the converter");
    run("cargo", ["build", "--release", "--bin", "pack-proving-key"], { cwd: checkout });
    return built;
}

function main(): void {
    const [name] = process.argv.slice(2);
    if (!name) die("usage: pack-proving-key.ts <circuit>");

    const circuit = parseCircuit(name);
    const { zkey, ark } = artifacts(circuit);

    if (!fs.existsSync(zkey)) {
        die(`.zkey not found: ${rel(zkey)}\n  Run 'pnpm run setup ${circuit}' first.`);
    }

    banner(`Packing the ${circuit} proving key`);

    const bin = converter();
    run(bin, [zkey, ark]);

    const mb = (file: string) => (fs.statSync(file).size / 1_048_576).toFixed(2);
    info("");
    ok(`${rel(ark)}`);
    info(`  .zkey  ${mb(zkey)} MB  →  .ark  ${mb(ark)} MB`);
    info("");
    info(`  snarkjs reads the .zkey; arkworks, wasm and mobile read the .ark`);
}

// Guarded because full-pipeline imports canPack() from here. An unconditional
// cli(main) would run the CLI — and abort on the missing argument — at import.
if (require.main === module) cli(main);
