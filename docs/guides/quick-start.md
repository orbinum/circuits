# Quick Start Guide

Welcome to Orbinum Circuits! This guide will help you get started with building and testing zero-knowledge circuits.

## Prerequisites

### System Requirements

- **Operating System**: Linux, macOS, or Windows (WSL2)
- **RAM**: 4GB minimum (8GB recommended)
- **Disk Space**: 2GB free space
- **Internet**: Required for downloading dependencies

### Required Software

#### Node.js (≥18.0.0)

```bash
# Check if installed
node --version

# Install via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

#### Circom Compiler (≥2.2.3)

```bash
# Download and install
wget https://github.com/iden3/circom/releases/download/v2.2.3/circom-linux-amd64
chmod +x circom-linux-amd64
sudo mv circom-linux-amd64 /usr/local/bin/circom

# Verify installation
circom --version
```

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/orbinum/circuits.git
cd circuits
```

### 2. Install Dependencies

```bash
pnpm install
```

This will:

- Install Node.js packages
- Set up pre-commit hooks
- Configure development environment

## Building Circuits

### One-Command Build

Build everything from scratch:

```bash
pnpm run build-all
```

This automatically:

1. ✓ Checks dependencies
2. ✓ Compiles circuits (Circom → R1CS + WASM)
3. ✓ Downloads Powers of Tau (72MB, cached)
4. ✓ Generates proving & verifying keys
5. ✓ Validates setup

**Expected time**: ~30 seconds (first run), ~10 seconds (subsequent)

### Step-by-Step Build

For more control, build circuits individually:

#### Step 1: Compile Circuit

```bash
# Compile the unshield circuit (active version 2, so `_v2` names)
pnpm run compile unshield

# Output:
# - build/unshield_v2.r1cs
# - build/unshield_v2.sym
# - build/unshield_js/unshield_v2.wasm
```

#### Step 2: Generate Keys

```bash
# Generate proving and verifying keys
pnpm run setup unshield

# Output:
# - keys/unshield_v2_pk.zkey
# - build/verification_key_unshield_v2.json
```

#### Step 3: Test Circuit

```bash
# Run tests
pnpm test -- --grep "Unshield"
```

## Your First Proof

### 1. Generate Test Input

`pnpm run fixture unshield` writes a valid, deterministic input to `fixtures/unshield.input.json` (see [unshield.md](../circuits/unshield.md) for the signals).

### 2. Generate Proof

```bash
# Using snarkjs directly
npx snarkjs groth16 fullprove \
  fixtures/unshield.input.json \
  build/unshield_js/unshield_v2.wasm \
  keys/unshield_v2_pk.zkey \
  build/proof.json \
  build/public.json
```

This generates:

- `build/proof.json` - The zero-knowledge proof
- `build/public.json` - Public signals

**Expected time**: <1s

### 3. Verify Proof

```bash
# Using snarkjs directly
npx snarkjs groth16 verify \
  build/verification_key_unshield_v2.json \
  build/public.json \
  build/proof.json
```

**Expected output**: `[INFO]  snarkJS: OK!`

## Testing

### Run All Tests

```bash
pnpm test
```

**Expected**: 129 tests passing in ~27 seconds

### Run Specific Tests

```bash
# Test a specific circuit
pnpm test -- --grep "Unshield"

# Test a specific component
pnpm test -- --grep "merkle"
```

### Test Coverage

| Test Suite            | Tests | Purpose                                              |
| --------------------- | ----- | ---------------------------------------------------- |
| `transfer.test.ts`    | 79    | Private transfer validation                          |
| `unshield.test.ts`    | 44    | Asset unshielding (total + partial with change note) |
| `merkle_tree.test.ts` | 15    | Merkle proof verification                            |
| `note.test.ts`        | 10    | Note commitments                                     |
| `poseidon_*.test.ts`  | 23    | Hash function tests                                  |

## Benchmarking

## Common Tasks

### Clean Build Artifacts

```bash
pnpm run clean
```

Removes:

- Build outputs
- Generated keys
- Temporary files

### Format Code

```bash
# Auto-format all files
pnpm run format

# Check formatting without changes
pnpm run format:check
```

### Lint Circuits

```bash
pnpm run lint:circom
```

## Project Structure

```
circuits/
├── circuits/          # Circuit definitions (.circom)
├── scripts/
│   ├── lib/           # Shared by every script: paths, logging, manifest, note crypto
│   ├── build/         # compile, setup, pack-proving-key, full-pipeline
│   ├── release/       # release, verify-artifacts, restore-artifacts
│   └── utils/         # generate-manifest, make-fixture, lint-circom
├── test/              # Test suite
├── fixtures/          # Deterministic circuit inputs (witnesses are generated)
├── npm/               # What gets published: entry point and package template
├── docs/              # Documentation
├── build/             # Compiled artifacts (gitignored)
└── keys/              # Proving keys (gitignored)
```

## Next Steps

### For Users

1. **Consuming the artifacts**: See the [arkworks integration guide](arkworks-integration.md)
2. **What each circuit proves**: [circuit documentation](../circuits/README.md)

### For Developers

1. **Architecture**: Review [ARCHITECTURE.md](../ARCHITECTURE.md)
2. **Working in this repository**: [CONTRIBUTING.md](../../CONTRIBUTING.md)
3. **Releasing**: [RELEASE.md](../RELEASE.md)

## Troubleshooting

### Common Issues

#### "circom: command not found"

```bash
# Install circom
wget https://github.com/iden3/circom/releases/download/v2.2.3/circom-linux-amd64
chmod +x circom-linux-amd64
sudo mv circom-linux-amd64 /usr/local/bin/circom
```

#### "Not enough memory"

Increase Node.js memory:

```bash
export NODE_OPTIONS="--max-old-space-size=8192"
pnpm run build-all
```

#### "PTAU download failed"

Manually download Powers of Tau:

```bash
mkdir -p ptau
cd ptau
wget https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau -O pot16_final.ptau
```

#### "Tests failing"

```bash
# Ensure circuits are built
pnpm run build-all

# Clear node_modules and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Run tests with verbose output
pnpm test -- --reporter spec
```

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/orbinum/circuits/issues)
- **Discord**: [Orbinum Community](https://discord.gg/orbinum)
- **Email**: dev@orbinum.net

## What's Next?

You've successfully set up Orbinum Circuits! Here are some next steps:

✅ **Built circuits** - All artifacts generated  
✅ **Ran tests** - Everything working  
✅ **Generated proofs** - Understanding the flow

Now you can:

- 🔍 **Explore circuits** - Dive into [circuit documentation](../circuits/README.md)
- 📦 **Consume the artifacts** - See the [arkworks integration guide](arkworks-integration.md)

Happy building! 🎉
