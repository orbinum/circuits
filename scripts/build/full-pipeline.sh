#!/bin/bash
# Full pipeline: compile circuit → setup
# Usage: bash scripts/build/full-pipeline.sh <circuit_name>
# Example: bash scripts/build/full-pipeline.sh disclosure

set -e

CIRCUIT=$1

if [ -z "$CIRCUIT" ]; then
    echo "Usage: $0 <circuit_name>"
    echo "Example: $0 disclosure"
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

# 3. Convert to Arkworks format (optional)
echo ""
echo -e "\033[0;34m[Phase 3/3]\033[0m Converting to Arkworks format...\n"
if command -v ark-circom &> /dev/null; then
    bash scripts/build/convert-to-ark.sh "$CIRCUIT" || echo -e "\033[1;33m      ⚠ Conversion skipped (non-critical)\033[0m"
else
    echo -e "\033[1;33m      ⚠ ark-circom not found, skipping .ark generation\033[0m"
    echo -e "      Install with: cargo install ark-circom"
fi

echo ""
echo -e "\033[0;32m══════════════════════════════════════════════════════════\033[0m"
echo -e "\033[0;32m             Pipeline Completed Successfully               \033[0m"
echo -e "\033[0;32m══════════════════════════════════════════════════════════\033[0m"
echo ""
