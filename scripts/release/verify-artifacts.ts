#!/usr/bin/env ts-node
/**
 * Fail-closed check that the local artifacts are byte-identical to what the
 * committed `manifest.json` declares.
 *
 * Run before any publish. Published artifacts are immutable, so anything
 * reaching npm has to match the manifest — and the manifest carries the
 * `vk_hash` the chain registers a verifying key by, which means a mismatch here
 * is a key nobody can verify against rather than a packaging annoyance.
 *
 * The traversal and the hashing live in `scripts/lib/manifest.ts`, shared with
 * the tests and the release script. This file is the command-line front for it.
 */
import fs from "fs";

import { PACKAGE_JSON, readManifest } from "../lib/manifest";
import { die, ok } from "../lib/log";
import { verifyAll } from "../lib/manifest";

function main(): void {
    const manifest = readManifest();
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));

    const errors: string[] = [];

    // The manifest names the version it describes. If that disagrees with
    // package.json, one of them was regenerated and the other was not.
    if (manifest.package_version !== pkg.version) {
        errors.push(
            `manifest package_version ${manifest.package_version} != package.json version ${pkg.version}`
        );
    }

    errors.push(...verifyAll(manifest));

    if (errors.length > 0) {
        die(`artifact verification FAILED:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    }
    ok("all manifest artifacts verified against local files");
}

main();
