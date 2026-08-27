# Contributing to Orbinum Circuits

> **⚠️ NOT ACCEPTING CONTRIBUTIONS**
>
> This project is currently in active development and **we are not accepting external contributions** at this time.
>
> The repository is open for transparency and reference purposes only.

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.

---

## Working in this repository

Notes for the team. Everything below is enforced by `pnpm check`, which is what
CI runs.

### Before pushing

```sh
pnpm check   # eslint, tsc, prettier, circom lint, tests
```

### Layout

| Path               | What lives there                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `circuits/`        | The circom sources. Three top-level circuits over a shared primitive layer (`note`, `merkle_tree`, `poseidon_wrapper`). |
| `scripts/lib/`     | Everything a build script needs more than once: paths, logging, process running, manifest traversal, the circuit list.  |
| `scripts/build/`   | Compile, trusted setup, and packing the proving key.                                                                    |
| `scripts/release/` | The manual release pipeline.                                                                                            |
| `test/helpers/`    | The note cryptography in JavaScript, and the artifact guard.                                                            |

Two rules keep that from eroding:

- **A helper used twice belongs in `scripts/lib/` or `test/helpers/`.** The note
  primitives were written four times before they were shared, and the ANSI
  colour block six — one of those copies referenced a colour it never defined,
  so four lines printed uncoloured for as long as the file existed.
- **Nothing hardcodes the list of circuits.** It is `CIRCUITS` in
  `scripts/lib/circuits.ts`.

### Tests

`pnpm test` skips the circuit suites when the compiled wasm is absent, so a
fresh checkout is green. That is deliberate and it is also a trap: a suite that
skips everything looks exactly like a suite that passes everything. Roughly
ninety tests once turned into pending without anything noticing.

`pnpm test:strict` sets `CIRCUITS_REQUIRE_ARTIFACTS=1`, which makes a missing
artifact a failure. **CI runs the strict form.** Run it before a release.

### Comments

Write down **why**, not what. The code says what it does; a comment repeating it
in prose costs a reader time and rots independently.

The convention this repository already follows in its newer files:

- **A header on anything non-trivial**, naming what the file is for and — where
  there is one — the bug it exists to prevent. `scripts/build/full-pipeline.ts`
  and `scripts/utils/lint-circom.ts` are the examples worth copying.
- **A number in a comment carries its source.** "Saves ~7,000 R1CS constraints
  vs EdDSA" (`circuits/transfer.circom:48`) is useful; "this is faster" is not.
- **Constraint comments in circom are numbered** and match the order they appear
  in. A reader following `docs/circuits/*.md` is using those numbers as an index.
- **Section dividers** as `// ─── Name ───`.

What not to write: `// Remove .r1cs file` above a line that removes a `.r1cs`
file.

### Metadata

Numbers describing a circuit — public-signal counts especially — live in
`scripts/lib/circuits.ts` and are checked against the compiled `.r1cs` and the
verifying key by `test/metadata.test.ts`. A hand-maintained copy elsewhere drifts:
the file that used to hold them claimed 300 constraints for a circuit that has
1151, and nothing caught it because nothing read the file.
