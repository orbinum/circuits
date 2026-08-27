/**
 * The numbers this repository states about its own circuits.
 *
 * A circuit's shape — how many public signals, how many constraints — is
 * recorded in several places: the compiled `.r1cs`, the verifying key's
 * `nPublic`, the manifest, and a table in `scripts/lib/circuits.ts`. Nothing
 * compared them, and they drifted: `config/circuits.config.json` claimed 300
 * constraints for `value_proof` where the real circuit has 1151, a factor of
 * 3.8 out, sitting unnoticed because no code read the file and no test checked
 * it.
 *
 * A stale constraint count is mostly an embarrassment. A stale *arity* is not:
 * a proof built against the wrong public-signal count is well-formed, is
 * exactly 128 bytes, and fails verification with nothing in the output to say
 * why. So the arity is checked against three independent sources, and the
 * hand-written table is one of them precisely because it cannot drift silently
 * with the others.
 */
import fs from "fs";
import path from "path";

import { expect } from "chai";

import { CIRCUITS, PUBLIC_SIGNALS, type CircuitName } from "../scripts/lib/circuits";
import { artifacts } from "../scripts/lib/paths";
import { readManifest } from "../scripts/lib/manifest";

/**
 * The constraint count from a compiled `.r1cs`.
 *
 * The header is: magic(4) version(4) nSections(4), then a section table of
 * (u32 type, u64 length) pairs. Section 1 is the header, whose layout is
 * fieldSize(u32), prime(fieldSize), nWires(u32), nPubOut(u32), nPubIn(u32),
 * nPrvIn(u32), nLabels(u64), nConstraints(u32).
 */
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
            // fieldSize + prime + nWires + nPubOut + nPubIn + nPrvIn + nLabels(8)
            return buf.readUInt32LE(off + 4 + fieldSize + 4 + 4 + 4 + 4 + 8);
        }
        off += len;
    }
    throw new Error(`${file}: no header section`);
}

/** The public-signal counts from the same header. */
function r1csSignals(file: string): { publicOutputs: number; publicInputs: number } {
    const buf = fs.readFileSync(file);
    const sections = buf.readUInt32LE(8);
    let off = 12;

    for (let i = 0; i < sections; i++) {
        const type = buf.readUInt32LE(off);
        const len = Number(buf.readBigUInt64LE(off + 4));
        off += 12;
        if (type === 1) {
            const fieldSize = buf.readUInt32LE(off);
            const base = off + 4 + fieldSize + 4; // past fieldSize, prime, nWires
            return {
                publicOutputs: buf.readUInt32LE(base),
                publicInputs: buf.readUInt32LE(base + 4),
            };
        }
        off += len;
    }
    throw new Error(`${file}: no header section`);
}

describe("Circuit metadata", function () {
    this.timeout(30_000);

    /** Circuits whose build artifacts are present, so this suite can say what it checked. */
    const built = CIRCUITS.filter((c) => fs.existsSync(artifacts(c).r1cs));

    before(function () {
        if (built.length === 0 && process.env.CIRCUITS_REQUIRE_ARTIFACTS) {
            throw new Error(
                "no compiled .r1cs found and CIRCUITS_REQUIRE_ARTIFACTS is set — " +
                    "run 'pnpm build-all' first"
            );
        }
    });

    describe("public-signal arity agrees across every source", () => {
        for (const circuit of CIRCUITS) {
            it(`${circuit}: table, verifying key and .r1cs agree`, function () {
                const { r1cs, vkJson } = artifacts(circuit);
                if (!fs.existsSync(r1cs) || !fs.existsSync(vkJson)) return this.skip();

                const declared = PUBLIC_SIGNALS[circuit as CircuitName];
                const vk = JSON.parse(fs.readFileSync(vkJson, "utf8"));
                const { publicOutputs, publicInputs } = r1csSignals(r1cs);

                expect(vk.nPublic, `${circuit}: verifying key disagrees with the table`).to.equal(
                    declared
                );

                // Circom counts outputs and public inputs separately; a verifier
                // sees their sum. `value_proof` is the case that matters: it
                // declares three public inputs and has a fourth signal,
                // `owner_hash`, which is an output.
                expect(
                    publicOutputs + publicInputs,
                    `${circuit}: .r1cs disagrees with the table`
                ).to.equal(declared);

                expect(vk.IC.length, `${circuit}: IC length is not arity plus one`).to.equal(
                    declared + 1
                );
            });
        }
    });

    describe("the manifest describes the circuits that exist", () => {
        it("every circuit in the table has a manifest entry", function () {
            const manifest = readManifest();
            for (const circuit of CIRCUITS) {
                expect(manifest.circuits, `${circuit} missing from the manifest`).to.have.property(
                    circuit
                );
            }
        });

        it("every manifest circuit has a source file", function () {
            const manifest = readManifest();
            for (const circuit of Object.keys(manifest.circuits)) {
                const source = path.join(__dirname, "..", "circuits", `${circuit}.circom`);
                expect(
                    fs.existsSync(source),
                    `manifest lists ${circuit} but circuits/${circuit}.circom does not exist`
                ).to.equal(true);
            }
        });

        it("the active version is one of the supported versions", function () {
            const manifest = readManifest();
            for (const [circuit, entry] of Object.entries(manifest.circuits)) {
                expect(
                    entry.supported_versions,
                    `${circuit}: active_version is not supported`
                ).to.include(entry.active_version);
            }
        });
    });

    describe("constraint counts are recorded, not guessed", () => {
        // Not asserted against a hardcoded number: constraint counts change
        // legitimately whenever a circuit does, and a test that has to be
        // updated with every edit gets updated without being read. What is
        // asserted is that the count is real and plausible — the failure this
        // catches is a truncated or absent .r1cs, not a redesign.
        for (const circuit of CIRCUITS) {
            it(`${circuit}: the .r1cs reports a usable constraint count`, function () {
                const { r1cs } = artifacts(circuit);
                if (!fs.existsSync(r1cs)) return this.skip();

                const n = r1csConstraints(r1cs);
                expect(n, `${circuit}: constraint count is not positive`).to.be.greaterThan(0);
                expect(n, `${circuit}: constraint count is implausibly large`).to.be.lessThan(
                    10_000_000
                );
            });
        }

        it("reports what it measured", function () {
            for (const circuit of built) {
                const n = r1csConstraints(artifacts(circuit).r1cs);
                console.log(`      ${circuit}: ${n} constraints`);
            }
            if (built.length === 0) this.skip();
        });
    });
});
