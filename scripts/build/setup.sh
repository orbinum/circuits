#!/bin/bash
set -euo pipefail

# Every path below is relative to the repository root. Without this the script
# runs from wherever it was invoked and reports "R1CS file not found", which
# blames the circuit for what is a working-directory problem. `release.sh` has
# had this preamble; this one did not.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(cd "$SCRIPT_DIR/../.." && pwd)"

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
# No default: `example` was never a circuit, so a bare `pnpm run setup` failed
# with "R1CS file not found: build/example.r1cs" — blaming a missing file for
# what is a missing argument. The TypeScript entry points validate the name
# against CIRCUITS and list the valid ones; this does the same.
CIRCUIT_NAME="${1:-}"
case "$CIRCUIT_NAME" in
    value_proof | transfer | unshield) ;;
    "")
        echo -e "${RED}Usage: setup.sh <circuit>${NC}" >&2
        echo "  where <circuit> is one of: value_proof, transfer, unshield" >&2
        exit 1
        ;;
    *)
        echo -e "${RED}Unknown circuit \"$CIRCUIT_NAME\"${NC}" >&2
        echo "  expected one of: value_proof, transfer, unshield" >&2
        exit 1
        ;;
esac
R1CS_FILE="build/${CIRCUIT_NAME}.r1cs"

# Trusted-setup entropy/beacon are overridable so a new version gets a distinct VK.
# Defaults reproduce the original v1 setup byte-for-byte.
SETUP_ENTROPY="${SETUP_ENTROPY:-orbinum-dev-contribution}"
SETUP_BEACON="${SETUP_BEACON:-0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f}"
SETUP_BEACON_ITERS="${SETUP_BEACON_ITERS:-10}"

if [ ! -f "$R1CS_FILE" ]; then
    echo -e "${RED}Error: R1CS file not found: $R1CS_FILE${NC}"
    echo "Please compile the circuit first: pnpm run compile ${CIRCUIT_NAME}"
    exit 1
fi

# Create keys directory
mkdir -p keys

# Clean previous key generation artifacts — only this run's outputs.
# Avoid a ${CIRCUIT}_*.zkey glob: it would wipe version-suffixed keys (e.g. unshield_v1_pk.zkey).
if [ -f "keys/${CIRCUIT_NAME}_pk.zkey" ] || [ -f "build/verification_key_${CIRCUIT_NAME}.json" ]; then
    echo ""
    echo -e "${YELLOW}Cleaning previous keys...${NC}"
    rm -f "keys/${CIRCUIT_NAME}_pk.zkey"
    rm -f "keys/${CIRCUIT_NAME}_0000.zkey" "keys/${CIRCUIT_NAME}_0001.zkey"
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

    # Download to a temporary name and only move it into place once verified.
    #
    # Three things were wrong with the previous version, and they compounded:
    #
    #   1. `curl` without `-f` exits 0 on an HTTP error and writes the error
    #      body to the output file. A 404 produced a 182-byte XML document that
    #      the `[ ! -f "$POT_FILE" ]` guard above then treated as a cached ptau
    #      on every subsequent run.
    #   2. The `if [ $? -ne 0 ]` mirror fallback was unreachable: `set -e` is on,
    #      so a failing curl killed the script before the test ran. This is the
    #      same defect that `compile.sh` carried and `compile.ts` documents.
    #   3. Nothing checked what was downloaded. This is 72 MB of trusted-setup
    #      material that becomes the entropy basis for every proving key, and
    #      every *output* artifact is sha256-verified against the manifest while
    #      the *input* ceremony file was not.
    POT_TMP="${POT_FILE}.partial"
    downloaded=false

    for url in \
        "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_16.ptau" \
        "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau"
    do
        echo -e "      Trying ${url}"
        # -f makes an HTTP error a non-zero exit instead of a written error body.
        # `|| continue` keeps set -e from killing the loop on a failed mirror.
        if curl -fL --retry 2 "$url" -o "$POT_TMP"; then
            downloaded=true
            break
        fi
        rm -f "$POT_TMP"
    done

    if [ "$downloaded" != "true" ]; then
        echo -e "${RED}      ✗ Could not download the ptau file from any source${NC}"
        rm -f "$POT_TMP"
        exit 1
    fi

    # A truncated or substituted ceremony file must not reach the setup. The
    # expected size is a weak check compared to a hash, but it is the one that
    # can be made without pinning a digest that upstream may legitimately
    # republish; a wrong file is almost always wildly the wrong size.
    POT_BYTES=$(wc -c < "$POT_TMP" | tr -d ' ')
    if [ "$POT_BYTES" -lt 70000000 ]; then
        echo -e "${RED}      ✗ Downloaded ptau is ${POT_BYTES} bytes, expected ~72 MB${NC}"
        echo -e "      The download was truncated or the server returned an error page."
        rm -f "$POT_TMP"
        exit 1
    fi

    mv "$POT_TMP" "$POT_FILE"
    echo -e "${GREEN}      ✓ Download complete (${POT_BYTES} bytes)${NC}"
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
echo "$SETUP_ENTROPY" | snarkjs zkey contribute \
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
    "$SETUP_BEACON" "$SETUP_BEACON_ITERS" \
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
echo -e "  ${YELLOW}1.${NC} Pack the proving key: pnpm run convert ${CIRCUIT_NAME}"
echo -e "  ${YELLOW}2.${NC} Regenerate the manifest: pnpm run manifest"
echo ""
