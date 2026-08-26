#!/bin/bash
# Full pipeline: compile circuit → setup
# Usage: bash scripts/build/full-pipeline.sh <circuit_name>
# Example: bash scripts/build/full-pipeline.sh value_proof

set -e

CIRCUIT=$1

if [ -z "$CIRCUIT" ]; then
    echo "Usage: $0 <circuit_name>"
    echo "Example: $0 value_proof"
    exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Circuit Build Pipeline: $CIRCUIT"
echo "══════════════════════════════════════════════════════════"
echo ""

# 1. Compile circuit
echo -e "\033[0;34m[Phase 1/2]\033[0m Compiling circuit...\n"
bash scripts/build/compile.sh "$CIRCUIT"

# 2. Setup (Powers of Tau + zkey generation)
echo ""
echo -e "\033[0;34m[Phase 2/3]\033[0m Generating cryptographic keys...\n"
bash scripts/build/setup.sh "$CIRCUIT"

# 3. Convert to Arkworks format
#
# The guard here used to test for an `ark-circom` binary, which does not exist —
# ark-circom is a library, and convert-to-ark.sh reaches it through a
# `cargo +nightly -Zscript`. So the test never passed and every build silently
# skipped .ark generation, which is how the checked-in keys drifted a month
# behind their .zkey and how manifest.json ended up with no `ark` entries at all.
# The real requirement is cargo, which convert-to-ark.sh validates itself.
echo ""
echo -e "\033[0;34m[Phase 3/3]\033[0m Converting to Arkworks format...\n"
if command -v cargo &> /dev/null; then
    bash scripts/build/convert-to-ark.sh "$CIRCUIT" || echo -e "\033[1;33m      ⚠ Conversion skipped (non-critical)\033[0m"
else
    echo -e "\033[1;33m      ⚠ cargo not found, skipping .ark generation\033[0m"
    echo -e "      Install Rust: https://rustup.rs"
fi

echo ""
echo -e "\033[0;32m══════════════════════════════════════════════════════════\033[0m"
echo -e "\033[0;32m             Pipeline Completed Successfully               \033[0m"
echo -e "\033[0;32m══════════════════════════════════════════════════════════\033[0m"
echo ""
