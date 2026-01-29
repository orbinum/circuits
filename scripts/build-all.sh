#!/bin/bash
# Build all circuits from scratch (ONE COMMAND)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cd "$PROJECT_DIR"

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}             Orbinum Circuits - Automated Build            ${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}[Step 1/4]${NC} Installing dependencies..."
    npm install
    echo ""
else
    echo -e "${GREEN}[Step 1/4]${NC} Dependencies already installed ✓"
    echo ""
fi

# Build all circuits
CIRCUITS=("disclosure" "transfer" "unshield")

for i in "${!CIRCUITS[@]}"; do
    CIRCUIT="${CIRCUITS[$i]}"
    STEP=$((i + 2))
    
    echo -e "${BLUE}[Step $STEP/4]${NC} Building ${CIRCUIT} circuit..."
    echo ""
    npm run full-build:${CIRCUIT}
    echo ""
done

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}              Build Completed Successfully                 ${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Generated Artifacts:${NC}"
echo ""
echo -e "${YELLOW}Disclosure Circuit:${NC}"
echo -e "  ${YELLOW}•${NC} build/disclosure_js/disclosure.wasm"
echo -e "  ${YELLOW}•${NC} keys/disclosure_pk.zkey"
echo -e "  ${YELLOW}•${NC} build/verification_key_disclosure.json"
echo ""
echo -e "${YELLOW}Transfer Circuit:${NC}"
echo -e "  ${YELLOW}•${NC} build/transfer_js/transfer.wasm"
echo -e "  ${YELLOW}•${NC} keys/transfer_pk.zkey"
echo -e "  ${YELLOW}•${NC} build/verification_key_transfer.json"
echo ""
echo -e "${YELLOW}Unshield Circuit:${NC}"
echo -e "  ${YELLOW}•${NC} build/unshield_js/unshield.wasm"
echo -e "  ${YELLOW}•${NC} keys/unshield_pk.zkey"
echo -e "  ${YELLOW}•${NC} build/verification_key_unshield.json"
echo ""
echo -e "${BLUE}Integration:${NC}"
echo -e "  ${YELLOW}Wallet CLI:${NC} Copy WASM + .zkey files for client-side proving"
echo -e "  ${YELLOW}Substrate:${NC} VK embedded in primitives/zk-verifier/src/vk/"
echo ""
