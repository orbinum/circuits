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
npm install
```

This will:

- Install Node.js packages
- Set up pre-commit hooks
- Configure development environment

## Building Circuits

### One-Command Build

Build everything from scratch:

```bash
npm run build-all
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
# Compile disclosure circuit
npm run compile:disclosure

# Output:
# - build/disclosure.r1cs (208KB)
# - build/disclosure.sym (129KB)
# - build/disclosure_js/disclosure.wasm (2.1MB)
```

#### Step 2: Generate Keys

```bash
# Generate proving and verifying keys
npm run setup:disclosure

# Output:
# - keys/disclosure_pk.zkey (689KB)
# - build/verification_key_disclosure.json (3.4KB)
```

#### Step 3: Test Circuit

```bash
# Run tests
npm test -- --grep "disclosure"
```

## Your First Proof

### 1. Generate Test Input

```bash
npm run gen-input:disclosure
```

This creates sample inputs in `build/input_*.json`:

- `reveal_nothing.json` - Full privacy mode
- `reveal_value_only.json` - Disclose amount only
- `reveal_value_and_asset.json` - Disclose amount + asset
- `reveal_all.json` - Complete disclosure

### 2. Generate Proof

```bash
npm run prove:disclosure
```

This generates:

- `build/proof.json` - The zero-knowledge proof
- `build/public.json` - Public signals

**Expected time**: ~100-150ms

### 3. Verify Proof

The proof is automatically verified during generation. You can also verify manually:

```bash
# Using snarkjs directly
npx snarkjs groth16 verify \
  build/verification_key_disclosure.json \
  build/public.json \
  build/proof.json
```

**Expected output**: `[INFO]  snarkJS: OK!`

## Testing

### Run All Tests

```bash
npm test
```

**Expected**: ~86 tests passing in 7 seconds

### Run Specific Tests

```bash
# Test a specific circuit
npm test -- --grep "disclosure"

# Test a specific component
npm test -- --grep "merkle"
```

### Test Coverage

| Test Suite            | Tests | Purpose                     |
| --------------------- | ----- | --------------------------- |
| `disclosure.test.ts`  | 12    | Selective disclosure logic  |
| `transfer.test.ts`    | 18    | Private transfer validation |
| `unshield.test.ts`    | 8     | Asset unshielding           |
| `merkle_tree.test.ts` | 15    | Merkle proof verification   |
| `note.test.ts`        | 10    | Note commitments            |
| `poseidon_*.test.ts`  | 23    | Hash function tests         |

## Benchmarking

### Run Benchmarks

```bash
# Benchmark disclosure circuit
npm run bench:disclosure

# Benchmark all circuits
npm run bench
```

### Typical Results

```
📊 Disclosure Circuit Benchmarks
  Witness Generation: 5.23ms avg
  Proof Generation:   101.29ms avg
  Verification:       3.87ms avg
  Throughput:         9.87 proofs/sec
```

Results saved to: `build/benchmark_results_disclosure.json`

## Common Tasks

### Clean Build Artifacts

```bash
npm run clean
```

Removes:

- Build outputs
- Generated keys
- Temporary files

### Format Code

```bash
# Auto-format all files
npm run format

# Check formatting without changes
npm run format:check
```

### Lint Circuits

```bash
npm run lint:circom
```

## Project Structure

```
circuits/
├── circuits/           # Circuit definitions (.circom)
├── build/             # Compiled artifacts (gitignored)
├── keys/              # Proving keys (gitignored)
├── scripts/           # Build and utility scripts
├── test/              # Test suite
├── benches/           # Performance benchmarks
└── docs/              # Documentation
```

## Next Steps

### For Users

1. **Integration**: See [Integration Guide](integration.md)
2. **API Reference**: Check [API Documentation](../api/)

### For Developers

1. **Architecture**: Review [ARCHITECTURE.md](../ARCHITECTURE.md)

### For Advanced Usage

1. **Custom Circuits**: Learn to [create new circuits](custom-circuits.md)
2. **Optimization**: Read about [constraint optimization](optimization.md)
3. **Production Setup**: Follow [production deployment guide](production.md)

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
npm run build-all
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
npm run build-all

# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Run tests with verbose output
npm test -- --reporter spec
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

- 🔍 **Explore circuits** - Dive into [circuit documentation](../circuits/)
- 🚀 **Deploy** - Follow [production guide](production.md)

Happy building! 🎉
