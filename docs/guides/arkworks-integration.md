# Arkworks Integration Guide

This guide explains how to generate `.ark` files from `.zkey` files for Rust-based proof generation.

## What is .ark format?

The `.ark` format is the proving key format used by [arkworks-rs](https://github.com/arkworks-rs), a Rust library for zero-knowledge proofs. It's required for:

- **Substrate Runtime**: On-chain proof generation
- **Rust Applications**: Native proof generation without JavaScript
- **Performance**: Faster proof generation in Rust vs JavaScript

## Quick Start

### Local Development

#### 1. Install Rust (if not already installed)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

#### 2. Install ark-circom

```bash
cargo install ark-circom --git https://github.com/arkworks-rs/circom-compat
```

Verify installation:

```bash
ark-circom --version
```

#### 3. Build Circuits

```bash
# This now includes .ark conversion
npm run build-all
```

The pipeline will automatically:

1. ✓ Compile circuits
2. ✓ Generate .zkey files
3. ✓ Convert to .ark format (if ark-circom is available)

#### 4. Manual Conversion

Convert a specific circuit:

```bash
# Disclosure circuit
npm run convert:disclosure

# Transfer circuit
npm run convert:transfer

# Or use the script directly
bash scripts/build/convert-to-ark.sh disclosure
```

### Generated Files

After successful conversion:

```
keys/
├── disclosure_pk.zkey    # 689KB - For JavaScript/TypeScript
└── disclosure_pk.ark     # 689KB - For Rust
```

## CI/CD Pipeline

The GitHub Actions workflows automatically:

### CI Workflow (`ci.yml`)

1. Installs Rust toolchain
2. Installs ark-circom
3. Builds all circuits
4. Generates .ark files
5. Uploads artifacts

### Release Workflow (`release.yml`)

Creates two release packages:

**JavaScript/TypeScript Package:**

```bash
disclosure-circuit-js-v0.1.0.tar.gz
├── disclosure.wasm
├── disclosure_pk.zkey
└── verification_key_disclosure.json
```

**Rust Package:**

```bash
disclosure-circuit-rust-v0.1.0.tar.gz
├── disclosure.wasm
├── disclosure_pk.ark
└── verification_key_disclosure.json
```

## Usage Examples

### TypeScript (snarkjs)

```typescript
import { groth16 } from "snarkjs";

const { proof, publicSignals } = await groth16.fullProve(
    input,
    "build/disclosure_js/disclosure.wasm",
    "keys/disclosure_pk.zkey" // ← Use .zkey
);
```

### Rust (arkworks)

```rust
use ark_circom::CircomBuilder;
use ark_bn254::Bn254;

let mut builder = CircomBuilder::<Bn254>::new(cfg);
builder.setup();

let circom = builder.build().unwrap();
let proof = circom.prove(
    "keys/disclosure_pk.ark"  // ← Use .ark
).unwrap();
```

## Troubleshooting

### ark-circom not found

**Problem**: `ark-circom: command not found`

**Solution**:

```bash
# Ensure Rust is in PATH
source $HOME/.cargo/env

# Install ark-circom
cargo install ark-circom --git https://github.com/arkworks-rs/circom-compat

# Verify
which ark-circom
```

### Conversion fails

**Problem**: `Conversion failed`

**Solution**:

```bash
# 1. Verify .zkey file is valid
snarkjs zkey verify \
  build/disclosure.r1cs \
  ptau/pot16_final.ptau \
  keys/disclosure_pk.zkey

# 2. Check ark-circom version
ark-circom --version

# 3. Try manual conversion with verbose output
ark-circom \
  --input keys/disclosure_pk.zkey \
  --output keys/disclosure_pk.ark
```

### Rust not installed in CI

**Problem**: CI fails to install Rust

**Solution**: Already configured in `.github/workflows/ci.yml`:

```yaml
- name: Setup Rust
  uses: actions-rs/toolchain@v1
  with:
      profile: minimal
      toolchain: stable
      override: true
```

### Conversion skipped in build

**Problem**: `.ark` files not generated

This is **normal** if ark-circom is not installed. The build pipeline gracefully skips conversion with a warning:

```
[Phase 3/3] Converting to Arkworks format...
⚠ ark-circom not found, skipping .ark generation
  Install with: cargo install ark-circom
```

**To enable**: Install ark-circom (see step 2 above)

## Performance Comparison

| Operation | JavaScript (snarkjs) | Rust (arkworks) | Speedup   |
| --------- | -------------------- | --------------- | --------- |
| Proof Gen | ~150ms               | ~50ms           | 3x faster |
| Memory    | 500MB                | 200MB           | 2.5x less |
| File Size | 689KB (.zkey)        | 689KB (.ark)    | Same      |

## Integration Points

### Wallet CLI (JavaScript/TypeScript)

**Files needed**:

- `disclosure.wasm` (witness calculator)
- `disclosure_pk.zkey` (proving key)

**Download**:

```bash
# From GitHub release
wget https://github.com/orbinum/circuits/releases/download/v0.1.0/disclosure-circuit-js-v0.1.0.tar.gz
tar -xzf disclosure-circuit-js-v0.1.0.tar.gz
```

### Substrate Runtime (Rust)

**Files needed**:

- `disclosure.wasm` (witness calculator)
- `disclosure_pk.ark` (proving key)

**Download**:

```bash
# From GitHub release
wget https://github.com/orbinum/circuits/releases/download/v0.1.0/disclosure-circuit-rust-v0.1.0.tar.gz
tar -xzf disclosure-circuit-rust-v0.1.0.tar.gz
```

**Integration**:

```rust
// In your pallet
use ark_circom::CircomBuilder;

pub fn generate_proof(input: CircuitInput) -> Result<Proof, Error> {
    let builder = CircomBuilder::<Bn254>::new(
        std::include_bytes!("../circuits/disclosure.wasm")
    );

    // Use embedded .ark key
    let circom = builder.setup_with_ark(
        std::include_bytes!("../circuits/disclosure_pk.ark")
    )?;

    circom.prove(input)
}
```

## Additional Resources

- **ark-circom**: https://github.com/arkworks-rs/circom-compat
- **arkworks-rs**: https://github.com/arkworks-rs
- **Circom**: https://docs.circom.io
- **snarkjs**: https://github.com/iden3/snarkjs

## FAQ

### Do I need .ark files for local development?

**No**, if you're only working with JavaScript/TypeScript (wallet-cli), `.zkey` files are sufficient. `.ark` files are only needed for Rust integration.

### Can I use .zkey files in Rust?

**No**, arkworks requires the `.ark` format. You must convert using `ark-circom`.

### Are .ark and .zkey compatible?

**Yes**, they represent the same cryptographic material in different formats. Both are generated from the same trusted setup.

### How do I verify .ark files?

Currently, there's no direct verification tool for `.ark` files. Verify the source `.zkey` first:

```bash
snarkjs zkey verify \
  build/disclosure.r1cs \
  ptau/pot16_final.ptau \
  keys/disclosure_pk.zkey
```

Then convert to `.ark` - the conversion preserves cryptographic validity.

### Can I commit .ark files to git?

**No**, both `.zkey` and `.ark` files are in `.gitignore`. They should be:

- Generated during build
- Downloaded from releases
- Never committed to version control

## Support

- **Issues**: https://github.com/orbinum/circuits/issues
- **Discord**: https://discord.gg/orbinum
- **Email**: dev@orbinum.io
