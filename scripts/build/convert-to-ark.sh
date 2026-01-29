#!/bin/bash
# Convert .zkey files to .ark format using ark-circom Rust library
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

cd "$PROJECT_DIR"

echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Convert .zkey to .ark Format (Arkworks)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

# Get circuit name from command line or default to "disclosure"
CIRCUIT_NAME="${1:-disclosure}"

KEYS_DIR="$PROJECT_DIR/keys"
ZKEY_FILE="$KEYS_DIR/${CIRCUIT_NAME}_pk.zkey"
ARK_FILE="$KEYS_DIR/${CIRCUIT_NAME}_pk.ark"

# Validate .zkey file exists
if [ ! -f "$ZKEY_FILE" ]; then
    echo -e "${RED}Error: .zkey file not found: $ZKEY_FILE${NC}"
    echo "Run 'npm run setup:$CIRCUIT_NAME' first."
    exit 1
fi

# Check if cargo is installed
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}Error: Cargo not found${NC}"
    echo ""
    echo "Rust and Cargo are required to convert .zkey to .ark format."
    echo ""
    echo "Install Rust:"
    echo -e "${BLUE}  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh${NC}"
    echo ""
    exit 1
fi
    exit 1
fi

ARK_VERSION=$(ark-circom --version 2>&1 || echo "unknown")

echo -e "${GREEN}✓ Cargo detected${NC}"
echo ""

# Convert .zkey to .ark using Rust script
echo "Converting: $ZKEY_FILE"
echo "       to: $ARK_FILE"
echo ""

RUST_SCRIPT="$SCRIPT_DIR/convert-to-ark.rs"

if [ ! -f "$RUST_SCRIPT" ]; then
    echo -e "${RED}Error: Conversion script not found: $RUST_SCRIPT${NC}"
    exit 1
fi

if cargo +nightly -Zscript "$RUST_SCRIPT" "$ZKEY_FILE" "$ARK_FILE"; then
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✓ Conversion completed successfully!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Generated artifacts:"
    ls -lh "$ZKEY_FILE" "$ARK_FILE" | awk '{print "  " $9 " (" $5 ")"}'
    echo ""
    echo "Usage:"
    echo "  • JavaScript/TypeScript:  disclosure_pk.zkey (snarkjs)"
    echo "  • Rust/Substrate (fast):  disclosure_pk.ark (pre-serialized)"
    echo "  • Rust/Substrate (compat): disclosure_pk.zkey (ark-circom)"
else
    echo ""
    echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
    echo -e "${RED}  ✗ Conversion failed${NC}"
    echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Possible causes:"
    echo "  • Invalid .zkey file format"
    echo "  • Missing Rust dependencies (ark-circom, ark-bn254, ark-serialize)"
    echo "  • Insufficient memory"
    echo ""
    exit 1
fi
