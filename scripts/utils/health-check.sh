#!/bin/bash
# Repository health check script

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}        Orbinum Circuits - Repository Health Check     ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

ERRORS=0
WARNINGS=0

# Check Node.js version
echo -e "${YELLOW}[1/8]${NC} Checking Node.js version..."
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 18 ]; then
    echo -e "${GREEN}      ✓ Node.js $(node --version) detected${NC}"
else
    echo -e "${RED}      ✗ Node.js version must be >= 18${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check Circom installation
echo ""
echo -e "${YELLOW}[2/8]${NC} Checking Circom compiler..."
if command -v circom &> /dev/null; then
    CIRCOM_VERSION=$(circom --version)
    echo -e "${GREEN}      ✓ Circom compiler found: $CIRCOM_VERSION${NC}"
else
    echo -e "${RED}      ✗ Circom compiler not found${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check dependencies
echo ""
echo -e "${YELLOW}[3/8]${NC} Checking npm dependencies..."
if [ -d "node_modules" ]; then
    echo -e "${GREEN}      ✓ Dependencies installed${NC}"
else
    echo -e "${RED}      ✗ Dependencies not installed (run: npm install)${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check for required files
echo ""
echo -e "${YELLOW}[4/8]${NC} Checking repository structure..."
REQUIRED_FILES=(
    "package.json"
    "tsconfig.json"
    ".prettierrc"
    ".gitignore"
    "README.md"
    "CHANGELOG.md"
    "CONTRIBUTING.md"
    "LICENSE"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}      ✓ $file${NC}"
    else
        echo -e "${RED}      ✗ Missing: $file${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
done

# Check circuits
echo ""
echo -e "${YELLOW}[5/8]${NC} Checking circuit files..."
CIRCUITS=("disclosure.circom" "transfer.circom" "unshield.circom")
for circuit in "${CIRCUITS[@]}"; do
    if [ -f "circuits/$circuit" ]; then
        echo -e "${GREEN}      ✓ $circuit${NC}"
    else
        echo -e "${RED}      ✗ Missing: circuits/$circuit${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done

# Check Git hooks
echo ""
echo -e "${YELLOW}[6/8]${NC} Checking Git hooks..."
if [ -f ".husky/pre-commit" ] && [ -x ".husky/pre-commit" ]; then
    echo -e "${GREEN}      ✓ Pre-commit hook installed${NC}"
else
    echo -e "${YELLOW}      ⚠ Pre-commit hook not executable${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

if [ -f ".husky/commit-msg" ] && [ -x ".husky/commit-msg" ]; then
    echo -e "${GREEN}      ✓ Commit-msg hook installed${NC}"
else
    echo -e "${YELLOW}      ⚠ Commit-msg hook not executable${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

# Check code formatting
echo ""
echo -e "${YELLOW}[7/8]${NC} Checking code formatting..."
if npm run format:check &> /dev/null; then
    echo -e "${GREEN}      ✓ All files properly formatted${NC}"
else
    echo -e "${YELLOW}      ⚠ Some files need formatting (run: npm run format)${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

# Check tests
echo ""
echo -e "${YELLOW}[8/8]${NC} Running tests..."
if [ -d "build" ] && [ -f "build/disclosure.r1cs" ]; then
    if npm test &> /dev/null; then
        echo -e "${GREEN}      ✓ All tests passing${NC}"
    else
        echo -e "${RED}      ✗ Some tests failing${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${YELLOW}      ⚠ Circuits not built (run: npm run build-all)${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

# Summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}                    Summary                            ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ Repository health check passed!${NC}"
    echo ""
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ Health check completed with $WARNINGS warning(s)${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Health check found $ERRORS error(s) and $WARNINGS warning(s)${NC}"
    echo ""
    echo "Please fix the errors above before proceeding."
    exit 1
fi
