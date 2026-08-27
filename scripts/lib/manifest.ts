/**
 * Reading `manifest.json`, and the one traversal everything needs.
 *
 * The manifest is a three-level structure — circuit → version → artifact — and
 * four separate places walked it with their own triple-nested loop, each typed
 * as `Object.entries<any>`: `verify-artifacts.ts`, `restore-artifacts.ts`, an
 * inline `node -e` inside `release.sh`, and `manifest_schema.test.ts`. Three of
 * them also computed sha256 with their own copy of the same three lines.
 *
 * The manifest is what the release pipeline packs from and what the chain's
 * `vk_hash` is published in, so a traversal that silently visits the wrong set
 * of artifacts is a release that ships the wrong bytes.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { MANIFEST_PATH, ROOT } from "./paths";

/** One artifact: a file the package publishes, with its integrity data. */
export interface Artifact {
    /** The flat name it is served under, e.g. `unshield_pk.zkey`. */
    file: string;
    /** Where it lives in this repository, relative to the root. */
    localPath: string;
    bytes: number;
    sha256: string;
}

export type ArtifactKind = "wasm" | "zkey" | "vk_json" | "ark" | "r1cs";

export interface Version {
    version: number;
    /** blake2_256 of the arkworks-packed verifying key — the chain's identity for it. */
    vk_hash: string;
    artifacts: Partial<Record<ArtifactKind, Artifact>>;
}

export interface CircuitEntry {
    active_version: number;
    supported_versions: number[];
    versions: Record<string, Version>;
}

export interface Manifest {
    schema_version: string;
    package_name: string;
    package_version: string;
    generated_at: string;
    circuits: Record<string, CircuitEntry>;
}

/** Read the committed manifest. */
export function readManifest(file = MANIFEST_PATH): Manifest {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
}

/** One artifact, with the coordinates that identify it. */
export interface ArtifactRef {
    circuit: string;
    version: string;
    kind: ArtifactKind;
    artifact: Artifact;
    /** An absolute path to the local file. */
    absolute: string;
    /** `unshield v1 zkey`, for messages. */
    label: string;
}

/**
 * Every artifact in the manifest, in a flat list.
 *
 * This replaces the four hand-written triple loops. Callers that need to filter
 * — by kind, by circuit — do it on the result, where the intent is visible.
 */
export function allArtifacts(manifest: Manifest, root = ROOT): ArtifactRef[] {
    const out: ArtifactRef[] = [];
    for (const [circuit, entry] of Object.entries(manifest.circuits)) {
        for (const [version, v] of Object.entries(entry.versions)) {
            for (const [kind, artifact] of Object.entries(v.artifacts)) {
                if (!artifact) continue;
                out.push({
                    circuit,
                    version,
                    kind: kind as ArtifactKind,
                    artifact,
                    absolute: path.join(root, artifact.localPath),
                    label: `${circuit} v${version} ${kind}`,
                });
            }
        }
    }
    return out;
}

/** The sha256 of a buffer, as lowercase hex. */
export function sha256Hex(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
}

/** The sha256 of a file. */
export function sha256File(file: string): string {
    return sha256Hex(fs.readFileSync(file));
}

/** What is wrong with one artifact, or `null` if it matches the manifest. */
export function checkArtifact(ref: ArtifactRef): string | null {
    if (!fs.existsSync(ref.absolute)) {
        return `${ref.label}: MISSING ${ref.artifact.localPath}`;
    }
    const data = fs.readFileSync(ref.absolute);
    if (data.length !== ref.artifact.bytes) {
        return `${ref.label}: size ${data.length} != manifest ${ref.artifact.bytes} (${ref.artifact.localPath})`;
    }
    if (sha256Hex(data) !== ref.artifact.sha256) {
        return `${ref.label}: sha256 mismatch (${ref.artifact.localPath})`;
    }
    return null;
}

/** Every artifact that disagrees with the manifest. Empty means the tree is clean. */
export function verifyAll(manifest: Manifest, root = ROOT): string[] {
    return allArtifacts(manifest, root)
        .map(checkArtifact)
        .filter((e): e is string => e !== null);
}
