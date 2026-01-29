#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}             Circuit Compilation - Orbinum                 ${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""

# Check if circom is installed
if ! command -v circom &> /dev/null; then
    echo -e "${RED}✗ Error: circom compiler not found${NC}"
    echo -e "  Install from: https://docs.circom.io/getting-started/installation/"
    exit 1
fi

CIRCOM_VERSION=$(circom --version)
echo -e "${GREEN}✓${NC} Circom compiler detected: $CIRCOM_VERSION"

# Get circuit name from argument or use default
CIRCUIT_NAME=${1:-example}
CIRCUIT_FILE="circuits/${CIRCUIT_NAME}.circom"

if [ ! -f "$CIRCUIT_FILE" ]; then
    echo -e "${RED}Error: Circuit file not found: $CIRCUIT_FILE${NC}"
    exit 1
fi

echo -e "${BLUE}Target circuit:${NC} ${CIRCUIT_NAME}"
echo ""

# Create build directory
mkdir -p build

# Clean previous compilation artifacts
if [ -f "build/${CIRCUIT_NAME}.r1cs" ] || [ -f "build/${CIRCUIT_NAME}.sym" ] || [ -d "build/${CIRCUIT_NAME}_js" ]; then
    echo -e "${YELLOW}Cleaning previous build artifacts...${NC}"
    rm -f "build/${CIRCUIT_NAME}.r1cs"
    rm -f "build/${CIRCUIT_NAME}.sym"
    rm -rf "build/${CIRCUIT_NAME}_js"
    echo -e "${GREEN}      ✓ Previous files removed${NC}"
    echo ""
fi

# Compile circuit
echo -e "${YELLOW}Compiling...${NC}"
circom "$CIRCUIT_FILE" \
    --r1cs \
    --wasm \
    --sym \
    --O1 \
    -o build/

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Compilation successful${NC}"

    # Show constraint count
    if command -v snarkjs &> /dev/null; then
        CONSTRAINTS=$(snarkjs r1cs info "build/${CIRCUIT_NAME}.r1cs" 2>&1 | grep "# of Constraints" | awk '{print $NF}')
        WIRES=$(snarkjs r1cs info "build/${CIRCUIT_NAME}.r1cs" 2>&1 | grep "# of Wires" | awk '{print $NF}')

        echo ""
        echo -e "${BLUE}Circuit Statistics:${NC}"
        echo -e "  ${YELLOW}•${NC} Constraints: $CONSTRAINTS"
        echo -e "  ${YELLOW}•${NC} Wires: $WIRES"
    fi

    echo ""
    echo -e "${BLUE}Generated Files:${NC}"
    ls -lh build/${CIRCUIT_NAME}.*
else
    echo -e "${RED}✗ Compilation failed${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo -e "  ${YELLOW}1.${NC} Generate keys: npm run setup:${CIRCUIT_NAME}"
echo -e "  ${YELLOW}2.${NC} Create proof: npm run prove:${CIRCUIT_NAME}"
echo -e "  ${YELLOW}3.${NC} Verify proof: npm run verify:${CIRCUIT_NAME}"
echo ""
