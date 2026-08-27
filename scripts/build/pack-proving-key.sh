#!/bin/bash
# Convert a snarkjs .zkey into a .ark v2 artifact (proving key + constraint
# matrices), using the converter that ships with groth16-proofs.
#
# This used to run a standalone `cargo -Zscript` that wrote only the proving key.
# Such a file cannot produce a proof: proving a Circom circuit needs the
# constraint matrices too, and `read_zkey` returns them alongside the key only to
# have them discarded on the way out. Every .ark this repo published was unusable
# for its stated purpose.
#
# The format now lives in groth16-proofs rather than here, so there is one
# definition of it and the reader and the writer cannot drift apart.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cd "$PROJECT_DIR"

CIRCUIT_NAME="${1:-value_proof}"
KEYS_DIR="$PROJECT_DIR/keys"
ZKEY_FILE="$KEYS_DIR/${CIRCUIT_NAME}_pk.zkey"
ARK_FILE="$KEYS_DIR/${CIRCUIT_NAME}_pk.ark"

# The converter lives in the sibling groth16-proofs checkout. Overridable so a
# release can point at a specific build.
GROTH16_DIR="${GROTH16_PROOFS_DIR:-$PROJECT_DIR/../groth16-proofs}"
CONVERTER="${PACK_PROVING_KEY_BIN:-$GROTH16_DIR/target/release/pack-proving-key}"

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Convert .zkey to .ark v2 (proving key + matrices)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

if [ ! -f "$ZKEY_FILE" ]; then
    echo -e "${RED}Error: .zkey file not found: $ZKEY_FILE${NC}"
    echo "Run 'pnpm run setup:$CIRCUIT_NAME' first."
    exit 1
fi

if [ ! -x "$CONVERTER" ]; then
    echo -e "${YELLOW}Building the converter…${NC}"
    if [ ! -d "$GROTH16_DIR" ]; then
        echo -e "${RED}Error: groth16-proofs checkout not found at $GROTH16_DIR${NC}"
        echo ""
        echo "Clone it beside this repo, or set GROTH16_PROOFS_DIR / PACK_PROVING_KEY_BIN."
        exit 1
    fi
    if ! command -v cargo &> /dev/null; then
        echo -e "${RED}Error: cargo not found${NC}"
        echo "Install Rust: https://rustup.rs"
        exit 1
    fi
    (cd "$GROTH16_DIR" && cargo build --release --bin pack-proving-key)
fi

echo -e "${GREEN}✓ Converter ready${NC}"
echo ""

if "$CONVERTER" "$ZKEY_FILE" "$ARK_FILE"; then
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✓ Conversion completed${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Usage:"
    echo "  • JavaScript/TypeScript (snarkjs):  ${CIRCUIT_NAME}_pk.zkey"
    echo "  • Rust / wasm / mobile (arkworks):  ${CIRCUIT_NAME}_pk.ark"
else
    echo ""
    echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
    echo -e "${RED}  ✗ Conversion failed${NC}"
    echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
    exit 1
fi
