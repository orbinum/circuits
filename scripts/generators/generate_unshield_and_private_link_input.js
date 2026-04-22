#!/usr/bin/env node
/**
 * Generates valid input JSON files for the unshield and private_link circuits.
 * Uses circomlibjs (already installed) for Poseidon hashing and Merkle trees.
 *
 * Usage:
 *   node scripts/generators/generate_unshield_and_private_link_input.js
 *
 * Outputs:
 *   build/unshield_input.json
 *   build/private_link_input.json
 */
"use strict";

const { buildPoseidon } = require("circomlibjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TREE_DEPTH = 20;
const BUILD_DIR = path.join(__dirname, "../../build");

// ── Merkle tree helpers ──────────────────────────────────────────────────────

function buildMerkleTree(poseidon, F, leaves) {
    // Pad to next power-of-two of size 2^TREE_DEPTH
    const size = 1 << TREE_DEPTH;
    const zero = F.zero;
    const nodes = new Array(size * 2).fill(zero);

    for (let i = 0; i < leaves.length; i++) {
        nodes[size + i] = leaves[i];
    }
    for (let i = size - 1; i >= 1; i--) {
        nodes[i] = poseidon([nodes[i * 2], nodes[i * 2 + 1]]);
    }
    return nodes;
}

function getMerklePath(nodes, leafIdx) {
    const size = 1 << TREE_DEPTH;
    const elements = [];
    const indices = [];
    let idx = size + leafIdx;
    for (let d = 0; d < TREE_DEPTH; d++) {
        const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
        elements.push(nodes[sibling]);
        indices.push(idx % 2 === 0 ? 0 : 1);
        idx = Math.floor(idx / 2);
    }
    return { elements, indices };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    const fStr = (x) => F.toString(x);

    // ── Unshield input ────────────────────────────────────────────────────────

    console.log("=== Generating unshield input ===");

    const note_value = BigInt(1000);
    const note_asset_id = BigInt(0);
    const note_owner = BigInt("12345678901234567890"); // arbitrary pubkey scalar
    const note_blinding = BigInt("0x" + crypto.randomBytes(31).toString("hex")) % F.p;
    const spending_key = BigInt("0x" + crypto.randomBytes(31).toString("hex")) % F.p;

    // commit = Poseidon(value, asset_id, owner, blinding)
    const commitment = poseidon([
        F.e(note_value),
        F.e(note_asset_id),
        F.e(note_owner),
        F.e(note_blinding),
    ]);

    // nullifier = Poseidon(commitment, spending_key)
    const nullifier = poseidon([commitment, F.e(spending_key)]);

    // Build a minimal Merkle tree with the commitment at leaf 0
    const leaves = [commitment];
    const treeNodes = buildMerkleTree(poseidon, F, leaves);
    const { elements: path_elements, indices: path_indices } = getMerklePath(treeNodes, 0);
    const merkle_root = treeNodes[1];

    const recipient = BigInt("42"); // non-zero recipient address
    const asset_id = note_asset_id;
    const amount = note_value; // unshield reveals exact amount

    const unshieldInput = {
        merkle_root: fStr(merkle_root),
        nullifier: fStr(nullifier),
        amount: amount.toString(),
        recipient: recipient.toString(),
        asset_id: asset_id.toString(),

        note_value: note_value.toString(),
        note_asset_id: note_asset_id.toString(),
        note_owner: note_owner.toString(),
        note_blinding: fStr(F.e(note_blinding)),
        spending_key: fStr(F.e(spending_key)),

        path_elements: path_elements.map(fStr),
        path_indices: path_indices,
    };

    const unshieldPath = path.join(BUILD_DIR, "unshield_input.json");
    fs.writeFileSync(unshieldPath, JSON.stringify(unshieldInput, null, 2));
    console.log(`  ✓ Saved: ${unshieldPath}`);
    console.log(`    commitment: ${fStr(commitment).slice(0, 20)}...`);
    console.log(`    merkle_root: ${fStr(merkle_root).slice(0, 20)}...`);

    // ── Private link input ────────────────────────────────────────────────────

    console.log("\n=== Generating private_link input ===");

    const chain_id_fe = BigInt(1); // chain id = 1 (Ethereum mainnet style)
    const address_fe = BigInt("0x" + crypto.randomBytes(20).toString("hex")); // 20-byte address
    const blinding_fe = BigInt("0x" + crypto.randomBytes(31).toString("hex")) % F.p;
    const call_hash_fe = BigInt("0x" + crypto.randomBytes(31).toString("hex")) % F.p;

    // commitment = Poseidon(Poseidon(chain_id_fe, address_fe), blinding_fe)
    const inner = poseidon([F.e(chain_id_fe), F.e(address_fe)]);
    const pl_commitment = poseidon([inner, F.e(blinding_fe)]);

    const privateLinkInput = {
        commitment: fStr(pl_commitment),
        call_hash_fe: fStr(F.e(call_hash_fe)),

        chain_id_fe: chain_id_fe.toString(),
        address_fe: fStr(F.e(address_fe)),
        blinding_fe: fStr(F.e(blinding_fe)),
    };

    const plPath = path.join(BUILD_DIR, "private_link_input.json");
    fs.writeFileSync(plPath, JSON.stringify(privateLinkInput, null, 2));
    console.log(`  ✓ Saved: ${plPath}`);
    console.log(`    commitment: ${fStr(pl_commitment).slice(0, 20)}...`);

    console.log("\n✅ Done");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
