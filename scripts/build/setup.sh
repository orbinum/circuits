#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}           Trusted Setup (Groth16) - Orbinum               ${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""

# Check if snarkjs is installed
if ! command -v snarkjs &> /dev/null; then
    echo -e "${RED}✗ Error: snarkjs not found${NC}"
    echo -e "  Install with: npm install -g snarkjs"
    exit 1
fi

echo -e "${GREEN}✓${NC} snarkjs detected"

# Get circuit name from argument or use default
CIRCUIT_NAME=${1:-example}
R1CS_FILE="build/${CIRCUIT_NAME}.r1cs"

if [ ! -f "$R1CS_FILE" ]; then
    echo -e "${RED}Error: R1CS file not found: $R1CS_FILE${NC}"
    echo "Please compile the circuit first: npm run compile:${CIRCUIT_NAME}"
    exit 1
fi

# Create keys directory
mkdir -p keys

# Clean previous key generation artifacts
if [ -f "keys/${CIRCUIT_NAME}_pk.zkey" ] || [ -f "build/verification_key_${CIRCUIT_NAME}.json" ]; then
    echo ""
    echo -e "${YELLOW}Cleaning previous keys...${NC}"
    rm -f "keys/${CIRCUIT_NAME}_pk.zkey"
    rm -f "keys/${CIRCUIT_NAME}_"*.zkey
    rm -f "build/verification_key_${CIRCUIT_NAME}.json"
    echo -e "${GREEN}      ✓ Previous keys removed${NC}"
fi

echo ""
echo -e "${BLUE}[1/6]${NC} Obtaining Powers of Tau..."
POT_FILE="ptau/pot16_final.ptau"

if [ ! -f "$POT_FILE" ]; then
    echo -e "      Downloading ceremony parameters (2^16 constraints, ~72 MB)"
    echo -e "      Source: Hermez trusted ceremony"

    mkdir -p ptau
    # Download from Hermez's trusted ceremony (correct URL)
    curl -L https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau -o $POT_FILE

    if [ $? -ne 0 ]; then
        echo -e "${YELLOW}      Retrying with mirror...${NC}"
        curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau -o $POT_FILE
    fi

    echo -e "${GREEN}      ✓ Download complete${NC}"
else
    echo -e "${GREEN}      ✓ Using cached file${NC}"
fi

echo ""
echo -e "${BLUE}[2/6]${NC} Phase 2: Circuit-specific setup..."
echo -e "      Generating initial proving key"

# Generate proving and verifying keys (suppress verbose output)
snarkjs groth16 setup \
    "$R1CS_FILE" \
    "$POT_FILE" \
    "keys/${CIRCUIT_NAME}_0000.zkey" > /dev/null 2>&1

echo -e "${GREEN}      ✓ Initial zkey generated${NC}"

echo ""
echo -e "${BLUE}[3/6]${NC} Adding entropy contribution..."
echo -e "      Contributor: Development build"

# Add a contribution (in production, multiple parties would do this)
echo "orbinum-dev-contribution" | snarkjs zkey contribute \
    "keys/${CIRCUIT_NAME}_0000.zkey" \
    "keys/${CIRCUIT_NAME}_0001.zkey" \
    --name="Dev Contribution 1" > /dev/null 2>&1

echo -e "${GREEN}      ✓ Contribution recorded${NC}"

# Finalize the proving key
echo ""
echo -e "${BLUE}[4/6]${NC} Finalizing proving key..."
echo -e "      Applying final beacon"
snarkjs zkey beacon \
    "keys/${CIRCUIT_NAME}_0001.zkey" \
    "keys/${CIRCUIT_NAME}_pk.zkey" \
    0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 \
    -n="Final Beacon phase2" > /dev/null 2>&1

echo -e "${GREEN}      ✓ Proving key ready${NC}"

# Export verifying key
echo ""
echo -e "${BLUE}[5/6]${NC} Exporting verifying key..."
mkdir -p build
snarkjs zkey export verificationkey \
    "keys/${CIRCUIT_NAME}_pk.zkey" \
    "build/verification_key_${CIRCUIT_NAME}.json" > /dev/null 2>&1

echo -e "${GREEN}      ✓ Verifying key exported${NC}"

# Verify the setup
echo ""
echo -e "${BLUE}[6/6]${NC} Validating setup integrity..."
VERIFY_OUTPUT=$(snarkjs zkey verify \
    "$R1CS_FILE" \
    "$POT_FILE" \
    "keys/${CIRCUIT_NAME}_pk.zkey" 2>&1)

if echo "$VERIFY_OUTPUT" | grep -q "ZKey Ok!"; then
    echo -e "${GREEN}      ✓ Verification passed${NC}"
else
    echo -e "${RED}      ✗ Verification failed${NC}"
    exit 1
fi

# Clean up intermediate files
echo ""
echo -e "${YELLOW}Cleaning up temporary files...${NC}"
rm -f "keys/${CIRCUIT_NAME}_0000.zkey" "keys/${CIRCUIT_NAME}_0001.zkey"

# Show file sizes
echo ""
echo -e "${BLUE}Generated Keys:${NC}"
ls -lh keys/${CIRCUIT_NAME}_pk.zkey build/verification_key_${CIRCUIT_NAME}.json

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}                Trusted Setup Complete                    ${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}⚠️  Security Notice:${NC}"
echo -e "  This is a ${RED}development setup${NC} for testing purposes only."
echo -e "  Production requires a multi-party ceremony (50+ contributors)."
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo -e "  ${YELLOW}1.${NC} Test proof generation: npm run prove:${CIRCUIT_NAME}"
echo -e "  ${YELLOW}2.${NC} Verify proof: npm run verify:${CIRCUIT_NAME}"
echo ""
