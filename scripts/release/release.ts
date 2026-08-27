#!/usr/bin/env ts-node
/**
 * Publish a release: npm package, tarballs, git tag, GitHub release.
 *
 * Manual and deliberate. CI never runs this — zkey and VK generation is
 * nondeterministic, so a CI rebuild would mint verifying keys that do not match
 * what is published and registered on-chain.
 *
 * The manifest is the packing list. Every artifact that ships is one the
 * manifest names, with the sha256 it records, verified before anything is
 * copied — published artifacts are immutable, so what reaches npm must match.
 *
 * Ported from `release.sh`. Three things the shell did that this does not:
 *
 * 1. **A guard that failed open.** `git ls-remote --exit-code && die` treated
 *    "tag does not exist" and "could not reach the remote" identically, because
 *    both are non-zero. Measured: a missing tag exits **2**, an unreachable
 *    remote exits **128**. So a network blip read as "the tag is free" and the
 *    release proceeded. In a script where every other guard fails closed, that
 *    one shipped.
 *
 * 2. **Re-implementing what already existed.** The version check ran twice per
 *    release — once in bash via two `node -p` subprocesses, once inside
 *    `verify-artifacts.ts` — and the manifest was walked by an inline `node -e`
 *    that duplicated `allArtifacts()`.
 *
 * 3. **`release/artifacts.tsv`**, a file that existed only to carry data
 *    between two `while read` loops in the same script.
 *
 * Usage:
 *   ts-node scripts/release/release.ts [--dry-run]
 */
import fs from "fs";
import path from "path";

import { allArtifacts, readManifest, sha256File } from "../lib/manifest";
import { banner, cli, die, info, ok, warn } from "../lib/log";
import { PACKAGE_JSON, ROOT, rel } from "../lib/paths";
import { requireTool, run, tryRun } from "../lib/run";

const PKG_DIR = path.join(ROOT, "pkg");
const RELEASE_DIR = path.join(ROOT, "release");

/** Exit code `git ls-remote` uses for "the ref does not exist". */
const GIT_REF_ABSENT = 2;

/**
 * Whether a tag exists on the remote.
 *
 * Distinguishes the three outcomes rather than collapsing them: 0 means the tag
 * is there, 2 means it is genuinely absent, anything else — 128 for an
 * unreachable remote or a failed auth — means the question was not answered and
 * the release must stop.
 */
function tagExistsOnRemote(tag: string): boolean {
    const probe = tryRun("git", [
        "ls-remote",
        "--exit-code",
        "--tags",
        "origin",
        `refs/tags/${tag}`,
    ]);
    if (probe.ok) return true;
    if (probe.status === GIT_REF_ABSENT) return false;

    die(
        `could not determine whether tag ${tag} exists on origin ` +
            `(git ls-remote exited ${probe.status}). Refusing to publish on an unanswered ` +
            `question — an unreachable remote is not the same as a free tag.\n` +
            (probe.stderr.trim() ? `  ${probe.stderr.trim()}` : "")
    );
}

/** The CHANGELOG section for this version, or a one-line fallback. */
function releaseNotes(version: string): string {
    const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8").split("\n");
    const start = changelog.findIndex((l) => l.startsWith(`## [${version}]`));
    if (start === -1) return `Release v${version}.`;

    const rest = changelog.slice(start + 1);
    const end = rest.findIndex((l) => l.startsWith("## ["));
    const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
    return body || `Release v${version}.`;
}

function main(): void {
    const dryRun = process.argv.includes("--dry-run");

    for (const tool of ["node", "pnpm", "git", "gh", "tar", "shasum"]) {
        requireTool(tool, `install ${tool}`);
    }

    // ── Guards ───────────────────────────────────────────────────────────────
    if (
        !tryRun("git", ["diff", "--quiet"]).ok ||
        !tryRun("git", ["diff", "--cached", "--quiet"]).ok
    ) {
        die("git working tree is dirty — commit or stash first");
    }

    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
    const version: string = pkg.version;
    const tag = `v${version}`;
    const manifest = readManifest();

    if (manifest.package_version !== version) {
        die(
            `manifest package_version (${manifest.package_version}) != package.json version ` +
                `(${version}) — regenerate and commit the manifest`
        );
    }
    if (tryRun("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]).ok) {
        die(`tag ${tag} already exists locally`);
    }
    if (tagExistsOnRemote(tag)) {
        die(`tag ${tag} already exists on origin`);
    }

    banner(`Release ${tag}${dryRun ? " (dry run)" : ""}`);

    // Fail-closed: every artifact must match the manifest before it is packed.
    run("npx", ["ts-node", "scripts/release/verify-artifacts.ts"]);

    // ── Assemble pkg/ from the manifest ──────────────────────────────────────
    fs.rmSync(PKG_DIR, { recursive: true, force: true });
    fs.rmSync(RELEASE_DIR, { recursive: true, force: true });
    fs.mkdirSync(PKG_DIR, { recursive: true });

    const artifacts = allArtifacts(manifest);
    fs.copyFileSync(path.join(ROOT, "manifest.json"), path.join(PKG_DIR, "manifest.json"));
    for (const { artifact, absolute } of artifacts) {
        fs.copyFileSync(absolute, path.join(PKG_DIR, artifact.file));
    }
    for (const file of ["npm/README.md", "npm/index.js", "npm/index.d.ts", "LICENSE"]) {
        fs.copyFileSync(path.join(ROOT, file), path.join(PKG_DIR, path.basename(file)));
    }

    // The published package.json is rendered from the template so its version
    // cannot drift from package.json. Parsed rather than regex-substituted: a
    // `"version"` key added anywhere in the template would otherwise be
    // rewritten too.
    const template = JSON.parse(
        fs.readFileSync(path.join(ROOT, "npm/package.json.template"), "utf8")
    );
    template.version = version;
    fs.writeFileSync(path.join(PKG_DIR, "package.json"), `${JSON.stringify(template, null, 2)}\n`);
    ok(`pkg/ assembled — ${artifacts.length} artifacts`);

    // ── Tarballs and checksums ───────────────────────────────────────────────
    const groups: Record<string, string[]> = { arkworks: [], snarkjs: [], vks: [] };
    for (const { kind, artifact } of artifacts) {
        if (kind === "wasm" || kind === "ark") groups.arkworks.push(artifact.file);
        else if (kind === "zkey") groups.snarkjs.push(artifact.file);
        else if (kind === "vk_json") groups.vks.push(artifact.file);
    }

    const tarballs: Record<string, string> = {
        arkworks: `orbinum-circuits-${tag}.tar.gz`,
        snarkjs: `orbinum-circuits-snarkjs-${tag}.tar.gz`,
        vks: `orbinum-verification-keys-${tag}.tar.gz`,
    };

    for (const [group, files] of Object.entries(groups)) {
        const dir = path.join(RELEASE_DIR, group);
        fs.mkdirSync(dir, { recursive: true });
        for (const file of files) {
            fs.copyFileSync(path.join(PKG_DIR, file), path.join(dir, file));
        }
        run("tar", ["-czf", path.join(RELEASE_DIR, tarballs[group]), "-C", dir, "."]);
    }

    const checksums = fs
        .readdirSync(PKG_DIR)
        .sort()
        .map((f) => `${sha256File(path.join(PKG_DIR, f))}  ./${f}`)
        .join("\n");
    const checksumFile = path.join(RELEASE_DIR, `checksums-${tag}.txt`);
    fs.writeFileSync(checksumFile, `${checksums}\n`);

    const notesFile = path.join(RELEASE_DIR, "release_notes.md");
    fs.writeFileSync(notesFile, `${releaseNotes(version)}\n`);
    ok(`tarballs and checksums in ${rel(RELEASE_DIR)}`);

    // ── npm ──────────────────────────────────────────────────────────────────
    if (tryRun("npm", ["view", `@orbinum/circuits@${version}`, "version"]).ok) {
        warn(`@orbinum/circuits@${version} is already on npm — skipping publish`);
    } else {
        const args = ["publish", "--no-git-checks", ...(dryRun ? ["--dry-run"] : [])];
        run("pnpm", args, { cwd: PKG_DIR });
    }

    // ── Tag and GitHub release, last so a partial failure is rerunnable ──────
    if (dryRun) {
        warn(`[dry-run] skipping: git tag ${tag}, git push, gh release create`);
    } else {
        run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
        run("git", ["push", "origin", tag]);
        run("gh", [
            "release",
            "create",
            tag,
            ...Object.values(tarballs).map((t) => path.join(RELEASE_DIR, t)),
            checksumFile,
            "--title",
            `Release ${tag}`,
            "--notes-file",
            notesFile,
        ]);
    }

    info("");
    ok(`release ${tag} complete${dryRun ? " (dry run)" : ""}`);
}

cli(main);
