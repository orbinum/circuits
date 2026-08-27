/**
 * The numbers, commands and links the documentation states.
 *
 * Documentation drifts, and this repository has the receipts: `value_proof`'s
 * constraint count was documented as `~300` against a real 1151 — a figure that
 * survived being called out as wrong in three separate places, including nine
 * lines above one of the tables that still printed it. Three different test
 * counts were documented, all of them false. Commands were listed for scripts
 * that no longer existed.
 *
 * None of that is caught by review, because a reader has no way to know that
 * `~300` was ever right. It is caught by deriving the number from the artifact
 * and comparing.
 *
 * What is checked here is only what can be derived mechanically: constraint
 * counts from the `.r1cs`, signal counts from the verifying key, the test count
 * from this suite, package size from the manifest, script names from
 * `package.json`, and whether a relative link resolves. Prose is not checked and
 * should not be — a test that fails when someone rewords a paragraph gets
 * deleted.
 */
import fs from "fs";
import path from "path";

import { expect } from "chai";

import { CIRCUITS, PUBLIC_SIGNALS, SIGNAL_LAYOUT, signalName } from "../scripts/lib/circuits";
import { ROOT, artifacts } from "../scripts/lib/paths";
import { allArtifacts, readManifest } from "../scripts/lib/manifest";

const rel = (f: string) => path.relative(ROOT, f);

/** Every markdown file that documents this repository. */
function markdownFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (
                    ["node_modules", ".git", "build", "keys", "ptau", "pkg", "release"].includes(
                        entry.name
                    )
                ) {
                    continue;
                }
                walk(full);
            } else if (entry.name.endsWith(".md")) {
                found.push(full);
            }
        }
    };
    walk(ROOT);
    return found.filter((f) => {
        // CHANGELOG is a historical record: its numbers describe past releases
        // and are meant to stay as they were written.
        if (path.basename(f) === "CHANGELOG.md") return false;
        // docs/planning/ holds proposals for work not done. They reference
        // files and commands that may never exist; holding them to this
        // standard would mean editing a proposal every time the code moves.
        if (rel(f).startsWith("docs/planning/")) return false;
        return true;
    });
}

/** The constraint count from a compiled `.r1cs` header. */
function r1csConstraints(file: string): number {
    const buf = fs.readFileSync(file);
    const sections = buf.readUInt32LE(8);
    let off = 12;
    for (let i = 0; i < sections; i++) {
        const type = buf.readUInt32LE(off);
        const len = Number(buf.readBigUInt64LE(off + 4));
        off += 12;
        if (type === 1) {
            const fieldSize = buf.readUInt32LE(off);
            return buf.readUInt32LE(off + 4 + fieldSize + 4 + 4 + 4 + 4 + 8);
        }
        off += len;
    }
    throw new Error(`${file}: no header section`);
}

describe("Documentation", function () {
    this.timeout(60_000);

    const docs = markdownFiles().map((file) => ({
        file,
        name: rel(file),
        text: fs.readFileSync(file, "utf8"),
    }));

    it("finds the documentation to check", function () {
        expect(docs.length, "no markdown found").to.be.greaterThan(3);
    });

    describe("constraint counts match the compiled circuits", () => {
        // Attributing every number in a document to the right circuit means
        // parsing prose and table headers, and a check built on that heuristic
        // spends its life reporting false positives until someone deletes it.
        //
        // What can be checked exactly is the inverse: a figure that *was* a
        // circuit's constraint count and no longer is must not appear. That is
        // the failure this exists for — `~300` outlived three written
        // corrections because nothing compared it to the artifact.
        it("no document states a constraint count that is no longer real", function () {
            const real = new Map<string, number>();
            for (const circuit of CIRCUITS) {
                const r1cs = artifacts(circuit).r1cs;
                if (fs.existsSync(r1cs)) real.set(circuit, r1csConstraints(r1cs));
            }
            if (real.size === 0) {
                if (process.env.CIRCUITS_REQUIRE_ARTIFACTS) {
                    throw new Error("no circuits are compiled — run 'pnpm build-all'");
                }
                return this.skip();
            }

            // Counts this repository has published in the past and has since
            // changed. Each maps to the circuit it used to describe, so the
            // failure message can say what to write instead.
            const superseded: Record<string, string> = {
                "300": "value_proof",
                "16,033": "unshield",
                "16033": "unshield",
                "12,000": "unshield",
                "32,000": "transfer",
                "487": "(the removed private_link circuit)",
            };

            for (const doc of docs) {
                for (const [i, line] of doc.text.split("\n").entries()) {
                    if (!/constraint/i.test(line)) continue;
                    // A line explaining that a number *used to* be stated is the
                    // record of the correction, not a repeat of the error.
                    if (
                        /claimed|used to|no longer|was wrong|incorrect|superseded|removed/i.test(
                            line
                        )
                    ) {
                        continue;
                    }
                    for (const [stale, circuit] of Object.entries(superseded)) {
                        if (!new RegExp(`~?\\b${stale.replace(",", ",?")}\\b`).test(line)) continue;
                        const correct = real.get(circuit);
                        expect.fail(
                            `${doc.name}:${i + 1} still states ${stale} constraints for ${circuit}` +
                                (correct ? `, which is now ${correct.toLocaleString()}` : "") +
                                `\n    ${line.trim()}`
                        );
                    }
                }
            }
        });

        it("the counts this repository does state are the measured ones", function () {
            // The one place a count is asserted rather than searched for: the
            // per-circuit documents, whose "Constraints:" line is theirs alone.
            for (const circuit of CIRCUITS) {
                const doc = path.join(ROOT, "docs", "circuits", `${circuit.replace("_", "-")}.md`);
                const file = fs.existsSync(doc)
                    ? doc
                    : path.join(ROOT, "docs", "circuits", `${circuit}.md`);
                const r1cs = artifacts(circuit).r1cs;
                if (!fs.existsSync(file) || !fs.existsSync(r1cs)) continue;

                const real = r1csConstraints(r1cs);
                const match = fs
                    .readFileSync(file, "utf8")
                    .match(/\*\*Constraints\*\*:\s*~?([\d,]+)/);
                if (!match) continue;

                expect(
                    Number(match[1].replace(/,/g, "")),
                    `${rel(file)} states ${match[1]} constraints, real is ${real}`
                ).to.equal(real);
            }
        });
    });

    describe("public-signal counts match the verifying keys", () => {
        for (const circuit of CIRCUITS) {
            it(`${circuit}'s declared arity matches its key`, function () {
                const vkJson = artifacts(circuit).vkJson;
                if (!fs.existsSync(vkJson)) {
                    if (process.env.CIRCUITS_REQUIRE_ARTIFACTS) {
                        throw new Error(`${circuit} has no verifying key — run 'pnpm build-all'`);
                    }
                    return this.skip();
                }
                const vk = JSON.parse(fs.readFileSync(vkJson, "utf8"));
                expect(PUBLIC_SIGNALS[circuit]).to.equal(vk.nPublic);
            });
        }

        it("no document puts value_proof's owner_hash last", function () {
            // Circom places `signal output` before public inputs in the witness,
            // so `owner_hash` is signal 0. Documenting it last is not a cosmetic
            // error: a verifier built from that ordering produces proofs that
            // fail with nothing in the output to explain why.
            const order = SIGNAL_LAYOUT.value_proof.map(signalName);
            expect(order[0], "the layout itself changed").to.equal("owner_hash");

            // The byte layout the pallet packs genuinely does put owner_hash
            // last, so the ordering alone is not the error — presenting it as
            // the *witness* order is. A line that says which one it means is
            // fine; one that leaves it ambiguous is the trap.
            // A byte-offset layout, which is the shape the confusion takes:
            // four names with ranges, owner_hash last.
            const byteLayout =
                /commitment\[[^\]]*\][^\n]*value\[[^\]]*\][^\n]*asset_id\[[^\]]*\][^\n]*owner_hash\[/;
            const disambiguated = /byte layout|on-chain|\bpallet\b/i;

            for (const doc of docs) {
                const lines = doc.text.split("\n");
                for (const [i, line] of lines.entries()) {
                    if (!byteLayout.test(line)) continue;
                    // The label usually sits a line or two above, outside the
                    // code fence the layout is written in.
                    const context = lines.slice(Math.max(0, i - 4), i + 1).join(" ");
                    if (disambiguated.test(context)) continue;
                    expect.fail(
                        `${doc.name}:${i + 1} orders owner_hash last without saying it is the ` +
                            `on-chain byte layout; in the witness it is signal 0\n    ${line.trim()}`
                    );
                }
            }
        });
    });

    describe("every documented command exists", () => {
        it("no document names a pnpm script that is gone", function () {
            const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
            const scripts = new Set(Object.keys(pkg.scripts));

            const pattern = /\b(?:pnpm|npm)\s+run\s+([a-z][a-z0-9:-]*)/g;
            for (const doc of docs) {
                for (const [i, line] of doc.text.split("\n").entries()) {
                    for (const m of line.matchAll(pattern)) {
                        expect(
                            scripts.has(m[1]),
                            `${doc.name}:${i + 1} runs "${m[1]}", which is not in package.json\n    ${line.trim()}`
                        ).to.equal(true);
                    }
                }
            }
        });

        it("no document invokes a shell script that no longer exists", function () {
            const pattern = /\bbash\s+(scripts\/[\w/-]+\.sh)/g;
            for (const doc of docs) {
                for (const [i, line] of doc.text.split("\n").entries()) {
                    for (const m of line.matchAll(pattern)) {
                        expect(
                            fs.existsSync(path.join(ROOT, m[1])),
                            `${doc.name}:${i + 1} runs "${m[1]}", which does not exist\n    ${line.trim()}`
                        ).to.equal(true);
                    }
                }
            }
        });
    });

    describe("every relative link resolves", () => {
        it("no document links to a file that is not there", function () {
            const pattern = /\]\((\.{1,2}\/[^)#\s]+|[\w][\w./-]*\.md)(?:#[^)]*)?\)/g;
            for (const doc of docs) {
                const dir = path.dirname(doc.file);
                for (const [i, line] of doc.text.split("\n").entries()) {
                    for (const m of line.matchAll(pattern)) {
                        const target = path.resolve(dir, m[1]);
                        expect(
                            fs.existsSync(target),
                            `${doc.name}:${i + 1} links to "${m[1]}", which does not exist`
                        ).to.equal(true);
                    }
                }
            }
        });
    });

    describe("structural claims match reality", () => {
        it("no document references a circuit that was removed", function () {
            // `private_link` was removed in 0.12.0, along with its tests, docs
            // and manifest entry. Anything still naming it describes a circuit
            // that cannot be built.
            for (const doc of docs) {
                for (const [i, line] of doc.text.split("\n").entries()) {
                    expect(
                        /private[_\s-]link/i.test(line),
                        `${doc.name}:${i + 1} references the removed private_link circuit\n    ${line.trim()}`
                    ).to.equal(false);
                }
            }
        });

        it("no document names a directory that does not exist", function () {
            const claimed = [
                "benches/",
                "scripts/e2e/",
                "scripts/ci/",
                "test/circuits/",
                "config/",
            ];
            for (const doc of docs) {
                for (const [i, line] of doc.text.split("\n").entries()) {
                    for (const dir of claimed) {
                        if (!line.includes(dir)) continue;
                        // A line explaining that something was removed is fine.
                        if (
                            /removed|deleted|replaced|no longer|used to|does not exist/i.test(line)
                        ) {
                            continue;
                        }
                        expect(
                            fs.existsSync(path.join(ROOT, dir)),
                            `${doc.name}:${i + 1} names "${dir}", which does not exist\n    ${line.trim()}`
                        ).to.equal(true);
                    }
                }
            }
        });

        it("the npm package documents every artifact kind it ships", function () {
            const kinds = new Set(allArtifacts(readManifest()).map((a) => a.kind));
            const readme = fs.readFileSync(path.join(ROOT, "npm", "README.md"), "utf8");

            for (const kind of kinds) {
                const extension = {
                    wasm: ".wasm",
                    zkey: ".zkey",
                    ark: ".ark",
                    r1cs: ".r1cs",
                    vk_json: "verification_key",
                }[kind];
                expect(
                    readme.includes(extension ?? kind),
                    `npm/README.md does not mention ${kind} (${extension}), which the package ships`
                ).to.equal(true);
            }
        });
    });
});
