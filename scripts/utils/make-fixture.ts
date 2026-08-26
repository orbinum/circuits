/**
 * Emits a deterministic circuit fixture: `input.json`, `<circuit>.wtns`, and the
 * witness as decimal strings.
 *
 * These exist so a prover outside this repo — the native Rust one, a mobile
 * FFI — can be measured and differential-tested against snarkjs without
 * reimplementing note construction first. Nothing in `circuits/` or
 * `groth16-proofs/` ships a `.wtns`, and `bench-groth16` cannot run without one.
 *
 * The inputs mirror `test/unshield.test.ts`'s `buildInput()` with its hardcoded
 * defaults, so the fixture is reproducible from nothing but this file: same
 * spending key, same blindings, same leaf index, every run. That is what makes
 * it usable as a golden vector — a fixture with a random blinding would prove a
 * different statement each time it was regenerated.
 *
 * Usage:
 *   pnpm exec ts-node scripts/utils/make-fixture.ts [circuit] [outDir]
 *
 * Defaults to the `unshield` circuit into `fixtures/`.
 */
import fs from "fs";
import path from "path";
import { buildPoseidon, buildBabyjub } from "circomlibjs";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs = require("snarkjs");

const ROOT = path.resolve(__dirname, "..", "..");

/** Matches `Unshield(20)` in circuits/unshield.circom. */
const TREE_DEPTH = 20;

/**
 * The `public [...]` list of the unshield circuit, in declaration order.
 *
 * The order is load-bearing: the witness carries public signals at indices
 * 1..=7 in exactly this sequence, and a prover that assumes a different one
 * produces a proof that fails verification with no error to explain it.
 */
const UNSHIELD_PUBLIC_SIGNALS = [
  "merkle_root",
  "nullifier",
  "amount",
  "recipient",
  "asset_id",
  "fee",
  "change_commitment",
] as const;

/**
 * The defaults from `test/unshield.test.ts`. Reproduced rather than imported
 * because they live inside a `describe()` closure there.
 */
const DEFAULTS = {
  noteValue: 1000n,
  amount: 1000n,
  fee: 0n,
  changeValue: 0n,
  assetId: 0n,
  blinding: 0xfedcba0987654321n,
  spendingKey: 0xdeadbeefcafebaben,
  recipient: 0xaabbccddee112233n,
  changeBlinding: 0xabcdef1234567890n,
  leafIndex: 0,
};

async function buildUnshieldInput() {
  const poseidon = await buildPoseidon();
  const babyJub = await buildBabyjub();
  const F = poseidon.F;

  const commit = (value: bigint, assetId: bigint, owner: bigint, blinding: bigint): bigint =>
    F.toObject(poseidon([value, assetId, owner, blinding]));

  const d = DEFAULTS;

  // Owner pubkey — matches the circuit's BabyPbk(spending_key).Ax
  const owner = F.toObject(babyJub.mulPointEscalar(babyJub.Base8, d.spendingKey)[0]);
  const commitment = commit(d.noteValue, d.assetId, owner, d.blinding);
  const nullifier = F.toObject(poseidon([commitment, d.spendingKey]));

  // A single leaf at index 0 means every sibling is the empty value, so the
  // path is all zeroes and the root is poseidon2(·, 0) chained TREE_DEPTH times.
  // Written as the general loop anyway, so a non-zero leafIndex still works.
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let level = new Map<number, bigint>([[d.leafIndex, commitment]]);
  for (let depth = 0; depth < TREE_DEPTH; depth++) {
    const nodeIdx = d.leafIndex >> depth;
    const isRight = nodeIdx % 2 === 1;
    pathIndices.push(isRight ? 1 : 0);
    pathElements.push(level.get(isRight ? nodeIdx - 1 : nodeIdx + 1) ?? 0n);

    const next = new Map<number, bigint>();
    for (const [pos] of level) {
      const parent = pos >> 1;
      if (next.has(parent)) continue;
      const l = level.get(parent * 2) ?? 0n;
      const r = level.get(parent * 2 + 1) ?? 0n;
      next.set(parent, F.toObject(poseidon([l, r])));
    }
    level = next;
  }
  const root = level.get(0) ?? 0n;

  // change_commitment is 0 for a total unshield — constraint 8b requires it.
  const changeCommitment =
    d.changeValue > 0n ? commit(d.changeValue, d.assetId, owner, d.changeBlinding) : 0n;

  return {
    // public
    merkle_root: root.toString(),
    nullifier: nullifier.toString(),
    amount: d.amount.toString(),
    recipient: d.recipient.toString(),
    asset_id: d.assetId.toString(),
    fee: d.fee.toString(),
    change_commitment: changeCommitment.toString(),
    // private
    note_value: d.noteValue.toString(),
    // Supplied even though --O1 eliminated it (varIdx -1 in unshield.sym): the
    // witness calculator still requires every declared input signal, it just
    // occupies no slot in the resulting vector.
    note_asset_id: d.assetId.toString(),
    note_blinding: d.blinding.toString(),
    spending_key: d.spendingKey.toString(),
    change_value: d.changeValue.toString(),
    change_blinding: d.changeBlinding.toString(),
    change_owner_pubkey: owner.toString(),
    path_elements: pathElements.map((e) => e.toString()),
    path_indices: pathIndices,
  };
}

const BUILDERS: Record<string, () => Promise<Record<string, unknown>>> = {
  unshield: buildUnshieldInput,
};

async function main() {
  const circuit = process.argv[2] ?? "unshield";
  const outDir = path.resolve(ROOT, process.argv[3] ?? "fixtures");

  const build = BUILDERS[circuit];
  if (!build) {
    throw new Error(
      `No fixture builder for "${circuit}". Available: ${Object.keys(BUILDERS).join(", ")}`
    );
  }

  const wasmPath = path.join(ROOT, "build", `${circuit}_js`, `${circuit}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Circuit wasm not found: ${wasmPath}. Run 'pnpm run compile:${circuit}' first.`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const inputPath = path.join(outDir, `${circuit}.input.json`);
  const wtnsPath = path.join(outDir, `${circuit}.wtns`);
  const decimalPath = path.join(outDir, `${circuit}.witness.json`);

  console.log(`Building ${circuit} input…`);
  const input = await build();
  fs.writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);

  console.log("Calculating witness…");
  const wtns = { type: "mem" } as { type: string; data?: Uint8Array };
  await snarkjs.wtns.calculate(input, fs.readFileSync(wasmPath), wtns);
  fs.writeFileSync(wtnsPath, Buffer.from(wtns.data!));

  const witness: bigint[] = await snarkjs.wtns.exportJson(wtns);
  fs.writeFileSync(
    decimalPath,
    `${JSON.stringify(
      { num_public_signals: UNSHIELD_PUBLIC_SIGNALS.length, witness: witness.map(String) },
      null,
      2
    )}\n`
  );

  // The witness layout is an unchecked contract with the proving key. Assert it
  // here, where a mismatch is one confusing line, rather than downstream where
  // it surfaces as a proof that verifies against nothing.
  if (witness[0] !== 1n) {
    throw new Error(`witness[0] is ${witness[0]}, expected the constant 1`);
  }
  for (const [i, name] of UNSHIELD_PUBLIC_SIGNALS.entries()) {
    const expected = BigInt(input[name] as string);
    if (witness[i + 1] !== expected) {
      throw new Error(
        `witness[${i + 1}] (${name}) is ${witness[i + 1]}, expected ${expected} — ` +
          `the public signal order does not match the circuit's public [...] list`
      );
    }
  }

  console.log(`\n✓ ${path.relative(ROOT, inputPath)}`);
  console.log(`✓ ${path.relative(ROOT, wtnsPath)} (${fs.statSync(wtnsPath).size} bytes)`);
  console.log(`✓ ${path.relative(ROOT, decimalPath)}`);
  console.log(`\n  witness elements:   ${witness.length}`);
  console.log(`  public signals:     ${UNSHIELD_PUBLIC_SIGNALS.length}`);
  console.log(`  witness[0]:         ${witness[0]} (constant)`);
  console.log(`  witness[1..7]:      verified against the public [...] order`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
