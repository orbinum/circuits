#!/bin/bash
# Simple linting for Circom files
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

# Get circom files to check
if [ $# -eq 0 ]; then
    # Check all circom files
    FILES=$(find circuits -name "*.circom" 2>/dev/null || echo "")
else
    # Check provided files
    FILES="$@"
fi

if [ -z "$FILES" ]; then
    echo -e "${GREEN}✓${NC} No circom files to lint"
    exit 0
fi

echo -e "${YELLOW}Linting Circom files...${NC}"

for file in $FILES; do
    if [ ! -f "$file" ]; then
        continue
    fi
    
    echo -n "  Checking $(basename $file)... "
    
    # Check for basic syntax issues
    if grep -q "template.*{" "$file" && grep -q "component main" "$file"; then
        echo -e "${GREEN}✓${NC}"
    elif grep -q "template.*{" "$file"; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗${NC} (invalid structure)"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Check for common mistakes
    if grep -q "==" "$file"; then
        if grep -q "signal.*==.*;" "$file"; then
            echo -e "  ${YELLOW}⚠${NC}  Warning: Use === for constraints, not =="
        fi
    fi
done

if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}✗${NC} Found $ERRORS error(s)"
    exit 1
else
    echo -e "${GREEN}✓${NC} All circom files passed basic checks"
    exit 0
fi
