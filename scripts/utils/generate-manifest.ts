#!/usr/bin/env ts-node

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { blake2b } from "@noble/hashes/blake2.js";

type CircuitName = "value_proof" | "transfer" | "unshield";
type ArtifactKind = "wasm" | "zkey" | "ark" | "r1cs" | "vk_json";

interface ArtifactEntry {
    file: string;
    localPath: string;
    bytes: number;
    sha256: string;
}

interface CircuitVersionEntry {
    version: number;
    vk_hash: string;
    artifacts: Partial<Record<ArtifactKind, ArtifactEntry>>;
}

interface Manifest {
    schema_version: string;
    package_name: string;
    package_version: string;
    generated_at: string;
    circuits: Record<
        CircuitName,
        {
            active_version: number;
            supported_versions: number[];
            versions: Record<string, CircuitVersionEntry>;
        }
    >;
}

const ROOT = path.resolve(__dirname, "../../");
const packageJsonPath = path.join(ROOT, "package.json");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageVersion = packageJson.version as string;
const packageName = packageJson.name as string;
const requireAllCircuits = process.env.MANIFEST_REQUIRE_ALL === "true";

const defaultCircuitVersion = Number(process.env.CIRCUIT_VERSION ?? "1");
if (!Number.isFinite(defaultCircuitVersion) || defaultCircuitVersion < 1) {
    throw new Error(`Invalid CIRCUIT_VERSION: ${process.env.CIRCUIT_VERSION}`);
}

const circuits: CircuitName[] = ["value_proof", "transfer", "unshield"];

function sha256Hex(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
}

// snarkjs VK JSON → arkworks compressed binary. Same conversion the node's VK
// registration runs, so its output is exactly the `key_data` stored on-chain.
const CONVERT_VK_BIN =
    process.env.CONVERT_VK_BIN ?? path.resolve(ROOT, "../groth16-proofs/target/release/convert-vk");

// Canonical VK hash = blake2_256 of the arkworks binary, identical to the chain's
// sp_io::hashing::blake2_256(key_data). Hashing vk.json instead would be a different
// hash of different bytes and never match the chain, so it fails closed if convert-vk
// is missing rather than falling back.
function computeVkHash(vkJsonPath: string): string {
    if (!fs.existsSync(CONVERT_VK_BIN)) {
        throw new Error(
            `convert-vk binary not found at ${CONVERT_VK_BIN}. ` +
                `Build it (cargo build --release -p groth16-proofs --bin convert-vk) or set CONVERT_VK_BIN.`
        );
    }
    const binPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vkhash-")), "vk.bin");
    try {
        execFileSync(CONVERT_VK_BIN, [vkJsonPath, binPath], { stdio: "pipe" });
        const bin = fs.readFileSync(binPath);
        const digest = blake2b(new Uint8Array(bin), { dkLen: 32 });
        return `0x${Buffer.from(digest).toString("hex")}`;
    } finally {
        fs.rmSync(path.dirname(binPath), { recursive: true, force: true });
    }
}

function readArtifact(localPath: string): ArtifactEntry | null {
    const absPath = path.join(ROOT, localPath);
    if (!fs.existsSync(absPath)) {
        return null;
    }

    const data = fs.readFileSync(absPath);
    return {
        file: path.basename(localPath),
        localPath,
        bytes: data.length,
        sha256: sha256Hex(data),
    };
}

// A version's artifacts live at either the base names (unshield_pk.zkey) or
// version-suffixed names (unshield_v2_pk.zkey). Suffixed names are REQUIRED for
// any non-base version so v1 and v2 don't collide in the flat served dir.
function artifactPaths(circuit: string, suffix: string) {
    const js = `build/${circuit}${suffix}`;
    return {
        wasm: `build/${circuit}_js/${circuit}${suffix}.wasm`,
        zkey: `keys/${circuit}${suffix}_pk.zkey`,
        ark: `keys/${circuit}${suffix}_pk.ark`,
        r1cs: `build/${circuit}${suffix}.r1cs`,
        vk_json: `build/verification_key_${circuit}${suffix}.json`,
        _js: js,
    };
}

// One version entry (vk_hash + per-artifact sha256) from the suffixed files.
function buildVersionEntry(
    circuit: string,
    version: number,
    suffix: string
): CircuitVersionEntry | null {
    const p = artifactPaths(circuit, suffix);
    const wasm = readArtifact(p.wasm);
    const zkey = readArtifact(p.zkey);
    const vkJson = readArtifact(p.vk_json);
    if (!wasm || !zkey || !vkJson) {
        console.warn(`⚠️  ${circuit} v${version}: missing wasm/zkey/vk_json (suffix "${suffix}")`);
        return null;
    }

    const artifacts: Partial<Record<ArtifactKind, ArtifactEntry>> = { wasm, zkey, vk_json: vkJson };
    const ark = readArtifact(p.ark);
    if (ark) artifacts.ark = ark;
    const r1cs = readArtifact(p.r1cs);
    if (r1cs) artifacts.r1cs = r1cs;

    return {
        version,
        vk_hash: computeVkHash(path.join(ROOT, p.vk_json)),
        artifacts,
    };
}

// Rotation controls: to add a version for ONE circuit, set ROTATE_CIRCUIT +
// ROTATE_VERSION. The prior manifest's versions are reused verbatim (their
// published bytes are canonical) and the new one is appended.
const rotateCircuit = process.env.ROTATE_CIRCUIT ?? "";
const rotateVersion = Number(process.env.ROTATE_VERSION ?? "0");
const priorManifest: Manifest | null = (() => {
    if (!rotateCircuit) return null;
    const p = path.join(ROOT, "manifest.json");
    return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Manifest) : null;
})();

function buildCircuitEntry(circuit: CircuitName): Manifest["circuits"][CircuitName] | null {
    // Rotation path: this circuit gets a new version merged onto the prior ones.
    if (circuit === rotateCircuit && rotateVersion > 0 && priorManifest) {
        const prior = priorManifest.circuits[circuit];
        if (!prior) throw new Error(`ROTATE_CIRCUIT=${circuit} not in prior manifest`);
        const newEntry = buildVersionEntry(circuit, rotateVersion, `_v${rotateVersion}`);
        if (!newEntry) throw new Error(`Failed to build ${circuit} v${rotateVersion} artifacts`);
        const versions = { ...prior.versions, [String(rotateVersion)]: newEntry };
        const supported = [...new Set([...prior.supported_versions, rotateVersion])].sort(
            (a, b) => a - b
        );
        return { active_version: rotateVersion, supported_versions: supported, versions };
    }

    // Default path: single-version entry from the base (unsuffixed) artifacts.
    const entry = buildVersionEntry(circuit, defaultCircuitVersion, "");
    if (!entry) return null;
    return {
        active_version: defaultCircuitVersion,
        supported_versions: [defaultCircuitVersion],
        versions: { [String(defaultCircuitVersion)]: entry },
    };
}

const skippedCircuits: CircuitName[] = [];

const circuitsManifestEntries = circuits
    .map((circuit) => [circuit, buildCircuitEntry(circuit)] as const)
    .filter((entry): entry is readonly [CircuitName, Manifest["circuits"][CircuitName]] => {
        if (entry[1] === null) {
            skippedCircuits.push(entry[0]);
            return false;
        }
        return true;
    });

if (circuitsManifestEntries.length === 0) {
    throw new Error(
        "No circuits with complete artifacts found. Build circuits before generating manifest."
    );
}

if (requireAllCircuits && skippedCircuits.length > 0) {
    throw new Error(
        `MANIFEST_REQUIRE_ALL=true and missing artifacts for circuits: ${skippedCircuits.join(", ")}`
    );
}

const manifest: Manifest = {
    schema_version: "1.0.0",
    package_name: packageName,
    package_version: packageVersion,
    generated_at: new Date().toISOString(),
    circuits: Object.fromEntries(circuitsManifestEntries) as Manifest["circuits"],
};

const outPath = path.join(ROOT, "manifest.json");
fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`✅ Manifest generated: ${outPath}`);
