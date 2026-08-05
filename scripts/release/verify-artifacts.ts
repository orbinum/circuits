#!/usr/bin/env ts-node

// Fail-closed check that local build/ + keys/ artifacts are byte-identical to
// what the committed manifest.json declares. Run before any publish: published
// artifacts are immutable, so anything reaching npm must match the manifest.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../../");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const errors: string[] = [];

if (manifest.package_version !== pkg.version) {
    errors.push(
        `manifest package_version ${manifest.package_version} != package.json version ${pkg.version}`
    );
}

for (const [circuit, entry] of Object.entries<any>(manifest.circuits)) {
    for (const [version, v] of Object.entries<any>(entry.versions)) {
        for (const [kind, a] of Object.entries<any>(v.artifacts)) {
            const label = `${circuit} v${version} ${kind}`;
            const abs = path.join(ROOT, a.localPath);
            if (!fs.existsSync(abs)) {
                errors.push(`${label}: MISSING ${a.localPath}`);
                continue;
            }
            const data = fs.readFileSync(abs);
            if (data.length !== a.bytes) {
                errors.push(
                    `${label}: size ${data.length} != manifest ${a.bytes} (${a.localPath})`
                );
            }
            const sha = crypto.createHash("sha256").update(data).digest("hex");
            if (sha !== a.sha256) {
                errors.push(`${label}: sha256 mismatch (${a.localPath})`);
            }
        }
    }
}

if (errors.length > 0) {
    console.error("✗ Artifact verification FAILED:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
}

console.log("✓ All manifest artifacts verified against local files.");
