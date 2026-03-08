#!/usr/bin/env ts-node

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

type CircuitName = "disclosure" | "transfer" | "unshield" | "private_link";
type ArtifactKind = "wasm" | "zkey" | "ark" | "vk_json";

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

const circuits: CircuitName[] = ["disclosure", "transfer", "unshield", "private_link"];

function sha256Hex(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
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

function buildCircuitEntry(circuit: CircuitName): Manifest["circuits"][CircuitName] | null {
    const wasmPath = `build/${circuit}_js/${circuit}.wasm`;
    const zkeyPath = `keys/${circuit}_pk.zkey`;
    const arkPath = `keys/${circuit}_pk.ark`;
    const vkJsonPath = `build/verification_key_${circuit}.json`;

    const wasm = readArtifact(wasmPath);
    const zkey = readArtifact(zkeyPath);
    const ark = readArtifact(arkPath);
    const vkJson = readArtifact(vkJsonPath);

    if (!wasm || !zkey || !vkJson) {
        console.warn(
            `⚠️  Skipping ${circuit}: missing required artifacts (wasm, zkey, verification_key_json)`
        );
        return null;
    }

    const artifacts: Partial<Record<ArtifactKind, ArtifactEntry>> = {
        wasm,
        zkey,
        vk_json: vkJson,
    };
    if (ark) {
        artifacts.ark = ark;
    }

    return {
        active_version: defaultCircuitVersion,
        supported_versions: [defaultCircuitVersion],
        versions: {
            [String(defaultCircuitVersion)]: {
                version: defaultCircuitVersion,
                vk_hash: `0x${vkJson.sha256}`,
                artifacts,
            },
        },
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
