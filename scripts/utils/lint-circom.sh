#!/bin/bash
# Lint Circom circuit files: static checks + circom compiler syntax validation
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CIRCUITS_DIR="$PROJECT_DIR/circuits"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

errors=0
warnings=0

# Collect circom files
if [ $# -eq 0 ]; then
    while IFS= read -r f; do FILES+=("$f"); done < <(find "$CIRCUITS_DIR" -name "*.circom" 2>/dev/null | sort)
else
    FILES=("$@")
fi

if [ ${#FILES[@]} -eq 0 ]; then
    echo -e "${GREEN}✓ No circom files found${NC}"
    exit 0
fi

# ── Static checks ──────────────────────────────────────────────────────────────
echo -e "${YELLOW}Static checks${NC}"

for file in "${FILES[@]}"; do
    [ -f "$file" ] || continue
    name="$(basename "$file")"
    file_errors=0

    # Missing pragma
    if ! grep -q 'pragma circom' "$file"; then
        echo -e "  ${RED}✗${NC} $name: missing 'pragma circom'"
        file_errors=$((file_errors + 1))
    fi

    # Empty file
    if [ ! -s "$file" ]; then
        echo -e "  ${RED}✗${NC} $name: file is empty"
        file_errors=$((file_errors + 1))
    fi

    # Unconstrained assignments (<-- outside comments)
    unconstrained=$(grep -n '<--' "$file" | grep -v '^\s*//' || true)
    if [ -n "$unconstrained" ]; then
        echo -e "  ${YELLOW}⚠${NC}  $name: unconstrained assignment (<--):"
        echo "$unconstrained" | while IFS= read -r line; do echo "       $line"; done
        warnings=$((warnings + 1))
    fi

    errors=$((errors + file_errors))
    [ "$file_errors" -eq 0 ] && echo -e "  ${GREEN}✓${NC} $name"
done

# ── Compiler syntax check ──────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Compiler syntax check${NC}"

if ! command -v circom &>/dev/null; then
    echo -e "  ${YELLOW}⚠${NC}  circom not in PATH — skipping compiler check"
    echo -e "       Install: https://docs.circom.io/getting-started/installation/"
else
    echo -e "  Using: $(circom --version 2>&1 | head -1)"
    echo ""

    TMPOUT="$(mktemp -d)"
    trap 'rm -rf "$TMPOUT"' EXIT

    for file in "${FILES[@]}"; do
        [ -f "$file" ] || continue

        # Only compile top-level circuits (those with component main)
        grep -q 'component main' "$file" || continue

        name="$(basename "$file")"
        echo -n "  $name ... "

        # Run from project root so node_modules/circomlib includes resolve
        output=$(cd "$PROJECT_DIR" && circom "$file" \
            --r1cs \
            --O1 \
            -o "$TMPOUT" \
            2>&1) && status=0 || status=$?

        if [ "$status" -eq 0 ]; then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${RED}✗${NC}"
            echo "$output" | grep -iE 'error|error\[' | head -15 | sed 's/^/       /'
            errors=$((errors + 1))
        fi
    done
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
if [ "$errors" -gt 0 ]; then
    echo -e "${RED}✗ Lint failed: $errors error(s)${NC}"
    [ "$warnings" -gt 0 ] && echo -e "  ${YELLOW}$warnings warning(s)${NC}"
    exit 1
else
    echo -e "${GREEN}✓ All checks passed${NC}"
    [ "$warnings" -gt 0 ] && echo -e "  ${YELLOW}$warnings warning(s) (unconstrained assignments)${NC}"
    exit 0
fi
