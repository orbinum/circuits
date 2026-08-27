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
 * Every download is checked against the committed manifest's sha256 before it
 * is written. A mismatch means the published artifact is not the one this
 * manifest describes, which is a rotation rather than a drift, and the file is
 * left alone.
 *
 * Usage:
 *   ts-node scripts/release/restore-artifacts.ts [--from <published-version>]
 *
 * Defaults to the npm `latest` version.
 */
import fs from "fs";
import path from "path";

import { allArtifacts, readManifest, sha256Hex } from "../lib/manifest";
import { die, info, ok } from "../lib/log";
import { run } from "../lib/run";

/** The published version to pull from: `--from`, or whatever npm calls latest. */
function sourceVersion(): string {
    const flag = process.argv.indexOf("--from");
    if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];
    return run("npm", ["view", "@orbinum/circuits", "version"], { capture: true }).trim();
}

async function main(): Promise<void> {
    const manifest = readManifest();
    const version = sourceVersion();
    const base = `https://unpkg.com/@orbinum/circuits@${version}`;

    let canonical = 0;
    let restored = 0;
    const errors: string[] = [];

    for (const ref of allArtifacts(manifest)) {
        const { absolute, artifact, label } = ref;

        if (fs.existsSync(absolute) && sha256Hex(fs.readFileSync(absolute)) === artifact.sha256) {
            canonical++;
            continue;
        }

        const url = `${base}/${artifact.file}`;
        const response = await fetch(url);
        if (!response.ok) {
            errors.push(`${label}: HTTP ${response.status} for ${url}`);
            continue;
        }

        const data = Buffer.from(await response.arrayBuffer());
        const sha = sha256Hex(data);
        if (sha !== artifact.sha256) {
            errors.push(
                `${label}: published sha256 ${sha} != manifest ${artifact.sha256} — ` +
                    `this artifact was rotated, so rebuild it locally instead of restoring`
            );
            continue;
        }

        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, data);
        info(`  ↓ ${artifact.localPath} from @orbinum/circuits@${version}`);
        restored++;
    }

    info(`  ${canonical} already canonical, ${restored} restored`);
    if (errors.length > 0) {
        die(`could not restore:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    }
    ok("local artifacts match the manifest");
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
