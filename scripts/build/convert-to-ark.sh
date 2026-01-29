#!/bin/bash
# Convert .zkey files to .ark format using ark-circom
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

# Check if ark-circom is installed
if ! command -v ark-circom &> /dev/null; then
    echo -e "${YELLOW}⚠️  ark-circom not found${NC}"
    echo ""
    echo "ark-circom is required to convert .zkey to arkworks format."
    echo "This is needed for Rust-based proof generation (Substrate runtime)."
    echo ""
    echo "Install with:"
    echo -e "${BLUE}  # Install Rust (if not installed)${NC}"
    echo -e "${BLUE}  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh${NC}"
    echo ""
    echo -e "${BLUE}  # Install ark-circom${NC}"
    echo -e "${BLUE}  cargo install ark-circom --git https://github.com/arkworks-rs/circom-compat${NC}"
    echo ""
    echo "Or skip this step if you only need .zkey (TypeScript/snarkjs)."
    exit 1
fi

ARK_VERSION=$(ark-circom --version 2>&1 || echo "unknown")
echo -e "${GREEN}✓ ark-circom detected: $ARK_VERSION${NC}"
echo ""

# Convert .zkey to .ark
echo "Converting: $ZKEY_FILE"
echo "       to: $ARK_FILE"
echo ""

if ark-circom --input "$ZKEY_FILE" --output "$ARK_FILE"; then
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✓ Conversion completed successfully!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Generated artifacts:"
    ls -lh "$ZKEY_FILE" "$ARK_FILE" | awk '{print "  " $9 " (" $5 ")"}'
    echo ""
    echo "Usage:"
    echo "  • JavaScript/TypeScript:  disclosure_pk.zkey"
    echo "  • Rust/Substrate:         disclosure_pk.ark"
else
    echo ""
    echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
    echo -e "${RED}  ✗ Conversion failed${NC}"
    echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Possible causes:"
    echo "  • Invalid .zkey file format"
    echo "  • ark-circom version mismatch"
    echo "  • Insufficient memory"
    echo ""
    exit 1
fi
