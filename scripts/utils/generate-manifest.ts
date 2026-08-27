#!/usr/bin/env ts-node

import * as fs from "node:fs";
import * as path from "node:path";

import { CIRCUITS, parseCircuit, type CircuitName } from "../lib/circuits";
import { MANIFEST_PATH, ROOT, rel } from "../lib/paths";
import { ok } from "../lib/log";
import {
    sha256Hex,
    type Artifact,
    type ArtifactKind,
    type Manifest,
    type Version,
} from "../lib/manifest";
import { computeVkHash } from "../lib/vk-hash";

// The manifest's shape lives in ../lib/manifest, shared with everything that
// reads the file. This script is the writer; redeclaring the types here would
// let the two drift, which is exactly the failure the shared layer exists to
// prevent.
type ArtifactEntry = Artifact;
type CircuitVersionEntry = Version;

const packageJsonPath = path.join(ROOT, "package.json");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const packageVersion = packageJson.version as string;
const packageName = packageJson.name as string;
const requireAllCircuits = process.env.MANIFEST_REQUIRE_ALL === "true";

const defaultCircuitVersion = Number(process.env.CIRCUIT_VERSION ?? "1");
if (!Number.isFinite(defaultCircuitVersion) || defaultCircuitVersion < 1) {
    throw new Error(`Invalid CIRCUIT_VERSION: ${process.env.CIRCUIT_VERSION}`);
}

// The circuit list lives in scripts/lib/circuits.ts so adding one means
// editing a single place.
const circuits: readonly CircuitName[] = CIRCUITS;

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
// Validated rather than compared raw: `circuit === rotateCircuit` against an
// unchecked string means a typo — ROTATE_CIRCUIT=trasnfer — never matches, so
// rotation silently falls through to the default path and emits a
// single-version manifest with no error. A rotation that quietly does not
// happen is worse than one that fails.
const rotateCircuit = process.env.ROTATE_CIRCUIT ? parseCircuit(process.env.ROTATE_CIRCUIT) : "";
const rotateVersion = Number(process.env.ROTATE_VERSION ?? "0");
if (rotateCircuit && (!Number.isInteger(rotateVersion) || rotateVersion < 1)) {
    throw new Error(
        `ROTATE_CIRCUIT=${rotateCircuit} needs ROTATE_VERSION set to a positive integer, ` +
            `got ${process.env.ROTATE_VERSION ?? "(unset)"}`
    );
}
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

fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
ok(`manifest generated: ${rel(MANIFEST_PATH)}`);
