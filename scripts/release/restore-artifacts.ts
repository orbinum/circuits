#!/usr/bin/env ts-node
/**
 * Restore canonical published artifacts into the local `build/` and `keys/`.
 *
 * Local artifacts drift: zkey and VK generation is nondeterministic, so a
 * rebuild produces different bytes than what was published. For circuits that
 * are *not* being rotated, a release needs the exact published bytes back —
 * otherwise the manifest would record a new `vk_hash` for a key the chain has
 * already registered, and every proof against it would stop verifying.
 *
 * The artifacts come from the package tarball, fetched once with `npm pack`:
 * the registry is the canonical source and npm checks the tarball's integrity.
 * A per-file CDN (unpkg) was a third party that intermittently answered 5xx.
 *
 * Every file is checked against the committed manifest's sha256 before it is
 * written. A mismatch means the published artifact is not the one this
 * manifest describes, which is a rotation rather than a drift, and the file is
 * left alone.
 *
 * Usage:
 *   ts-node scripts/release/restore-artifacts.ts [--from <published-version>] [--keys-only]
 *
 * Defaults to the npm `latest` version.
 *
 * `--keys-only` restores just the ceremony outputs — zkey, verifying key, and
 * `.ark` — and leaves the wasm and r1cs of the version the source builds alone.
 * Those two are compiler output: they come from the `.circom` in the working
 * tree, deterministically, so in CI they should be whatever this commit compiles
 * to. Restoring them would overwrite the code under test with the published
 * bytes, and any commit that legitimately changes a circuit would fail here on a
 * sha256 mismatch rather than in a test. The ceremony outputs are the opposite:
 * nondeterministic, so the published ones are the only ones that mean anything.
 * Older published versions are restored whole: the source no longer compiles
 * them, so their wasm and r1cs exist only in the package.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { type Manifest, allArtifacts, readManifest, sha256Hex } from "../lib/manifest";
import { ROOT, sourceVersion as builtVersion } from "../lib/paths";
import { die, info, ok } from "../lib/log";
import { run } from "../lib/run";

/** The published version to pull from: `--from`, or whatever npm calls latest. */
function sourceVersion(): string {
    const flag = process.argv.indexOf("--from");
    if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];
    return run("npm", ["view", "@orbinum/circuits", "version"], { capture: true }).trim();
}

/** Artifact kinds that a compiler cannot reproduce, so must come from the publish. */
const CEREMONY_KINDS: ReadonlySet<string> = new Set(["zkey", "vk_json", "ark"]);

function main(): void {
    const manifest = readManifest();
    const version = sourceVersion();
    const keysOnly = process.argv.includes("--keys-only");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "circuits-restore-"));
    let result: RestoreResult;
    try {
        result = restore(manifest, unpack(version, tmp), { keysOnly });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    for (const p of result.written) info(`  ↓ ${p} from @orbinum/circuits@${version}`);
    info(
        `  ${result.canonical} already canonical, ${result.written.length} restored` +
            (keysOnly ? " (keys-only)" : "")
    );
    if (result.errors.length > 0) {
        die(`could not restore:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`);
    }
    ok("local artifacts match the manifest");
}

/** Fetch the published package and unpack it into `dir`; returns its root. */
function unpack(version: string, dir: string): string {
    const tarball = run(
        "npm",
        ["pack", `@orbinum/circuits@${version}`, "--pack-destination", dir, "--silent"],
        { capture: true }
    )
        .trim()
        .split("\n")
        .pop();
    if (!tarball) die(`npm pack @orbinum/circuits@${version} produced no tarball`);
    run("tar", ["-xzf", path.join(dir, tarball), "-C", dir]);
    return path.join(dir, "package");
}

export interface RestoreResult {
    canonical: number;
    /** `localPath` of each file written. */
    written: string[];
    errors: string[];
}

/** Whether `child` resolves inside `parent`. */
const inside = (parent: string, child: string): boolean => {
    const rel = path.relative(parent, child);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * Copy every manifest artifact that is missing or drifted locally from the
 * unpacked package at `pkg`, writing a file only if its sha256 is the one the
 * manifest records. Nothing outside `root` is written and nothing outside `pkg`
 * is read, whatever the manifest names.
 */
export function restore(
    manifest: Manifest,
    pkg: string,
    opts: { keysOnly?: boolean; root?: string } = {}
): RestoreResult {
    const root = opts.root ?? ROOT;
    const result: RestoreResult = { canonical: 0, written: [], errors: [] };

    for (const ref of allArtifacts(manifest, root)) {
        const { absolute, artifact, label } = ref;

        const compiled = Number(ref.version) === builtVersion(ref.circuit);
        if (opts.keysOnly && compiled && !CEREMONY_KINDS.has(ref.kind)) continue;

        const published = path.join(pkg, artifact.file);
        if (!inside(root, absolute) || !inside(pkg, published)) {
            result.errors.push(
                `${label}: path escapes its directory (${artifact.localPath}, ${artifact.file})`
            );
            continue;
        }

        if (fs.existsSync(absolute) && sha256Hex(fs.readFileSync(absolute)) === artifact.sha256) {
            result.canonical++;
            continue;
        }

        if (!fs.existsSync(published)) {
            result.errors.push(`${label}: ${artifact.file} is not in the published package`);
            continue;
        }

        const data = fs.readFileSync(published);
        const sha = sha256Hex(data);
        if (sha !== artifact.sha256) {
            result.errors.push(
                `${label}: published sha256 ${sha} != manifest ${artifact.sha256} — ` +
                    `this artifact was rotated, so rebuild it locally instead of restoring`
            );
            continue;
        }

        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, data);
        result.written.push(artifact.localPath);
    }
    return result;
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        die(err instanceof Error ? err.message : String(err));
    }
}
