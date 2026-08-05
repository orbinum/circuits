#!/usr/bin/env ts-node

// Restore canonical published artifacts into local build/ + keys/.
//
// Local artifacts drift: zkey/VK regeneration is nondeterministic, so a rebuild
// produces different bytes than what was published. For circuits that are NOT
// being rotated, the release needs the exact published bytes back. This pulls
// every artifact whose local copy is missing or mismatched from unpkg (pinned
// to a published package version) and fail-closed verifies sha256 against the
// committed manifest before writing.
//
// Usage: ts-node scripts/release/restore-artifacts.ts [--from <published-version>]
//        (default: the npm "latest" version)

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../../");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

const fromIdx = process.argv.indexOf("--from");
const fromVersion =
    fromIdx !== -1
        ? process.argv[fromIdx + 1]
        : execFileSync("npm", ["view", "@orbinum/circuits", "version"], {
              encoding: "utf8",
          }).trim();

const BASE = `https://unpkg.com/@orbinum/circuits@${fromVersion}`;

function sha256Hex(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
}

async function main() {
    let restored = 0;
    let ok = 0;
    const errors: string[] = [];

    for (const [circuit, entry] of Object.entries<any>(manifest.circuits)) {
        for (const [version, v] of Object.entries<any>(entry.versions)) {
            for (const [kind, a] of Object.entries<any>(v.artifacts)) {
                const label = `${circuit} v${version} ${kind}`;
                const abs = path.join(ROOT, a.localPath);
                if (fs.existsSync(abs) && sha256Hex(fs.readFileSync(abs)) === a.sha256) {
                    ok++;
                    continue;
                }
                const url = `${BASE}/${a.file}`;
                const res = await fetch(url);
                if (!res.ok) {
                    errors.push(`${label}: HTTP ${res.status} for ${url}`);
                    continue;
                }
                const data = Buffer.from(await res.arrayBuffer());
                const sha = sha256Hex(data);
                if (sha !== a.sha256) {
                    errors.push(
                        `${label}: published sha256 ${sha} != manifest ${a.sha256} — ` +
                            `this artifact was rotated/changed; rebuild it locally instead`
                    );
                    continue;
                }
                fs.mkdirSync(path.dirname(abs), { recursive: true });
                fs.writeFileSync(abs, data);
                console.log(`↓ restored ${a.localPath} from @orbinum/circuits@${fromVersion}`);
                restored++;
            }
        }
    }

    console.log(`${ok} already canonical, ${restored} restored.`);
    if (errors.length > 0) {
        console.error("✗ Could not restore:");
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
