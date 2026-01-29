# Makefile for Orbinum Circuits

.PHONY: help install build test clean format lint all

# Default target
help:
	@echo "Orbinum Circuits - Available Commands"
	@echo "====================================="
	@echo ""
	@echo "Setup:"
	@echo "  make install       Install dependencies"
	@echo ""
	@echo "Build:"
	@echo "  make build         Build all circuits"
	@echo "  make build-fast    Build without tests"
	@echo ""
	@echo "Test:"
	@echo "  make test          Run all tests"
	@echo "  make test-watch    Run tests in watch mode"
	@echo "  make bench         Run benchmarks"
	@echo ""
	@echo "Development:"
	@echo "  make format        Format code"
	@echo "  make lint          Lint circuits"
	@echo "  make check         Run all checks"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean         Remove build artifacts"
	@echo "  make clean-all     Remove everything (including node_modules)"
	@echo ""
	@echo "Release:"
	@echo "  make release       Create release artifacts"
	@echo ""

# Install dependencies
install:
	@echo "📦 Installing dependencies..."
	npm install
	@echo "✅ Installation complete"

# Build all circuits
build:
	@echo "🔨 Building all circuits..."
	npm run build-all
	@echo "✅ Build complete"

# Build without running tests (faster)
build-fast:
	@echo "🔨 Building circuits (fast mode)..."
	npm run full-build:disclosure
	@echo "✅ Build complete"

# Run tests
test:
	@echo "🧪 Running tests..."
	npm test
	@echo "✅ Tests passed"

# Run tests in watch mode
test-watch:
	@echo "👀 Running tests in watch mode..."
	npm test -- --watch

# Run benchmarks
bench:
	@echo "📊 Running benchmarks..."
	npm run bench
	@echo "✅ Benchmarks complete"

# Format code
format:
	@echo "💅 Formatting code..."
	npm run format
	@echo "✅ Formatting complete"

# Check formatting
format-check:
	@echo "🔍 Checking code format..."
	npm run format:check

# Lint circuits
lint:
	@echo "🔍 Linting circuits..."
	npm run lint:circom
	@echo "✅ Linting complete"

# Run all checks
check: format-check lint test
	@echo "✅ All checks passed"

# Clean build artifacts
clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf build/*.r1cs build/*.sym build/*.wtns build/*_js
	rm -rf keys/*.zkey
	rm -rf ptau/*.ptau
	@echo "✅ Cleanup complete"

# Clean everything including node_modules
clean-all: clean
	@echo "🧹 Removing node_modules..."
	rm -rf node_modules package-lock.json
	@echo "✅ Deep cleanup complete"

# Create release artifacts
release: clean build
	@echo "📦 Creating release artifacts..."
	mkdir -p release
	tar -czf release/disclosure-circuit.tar.gz \
		build/disclosure_js/disclosure.wasm \
		keys/disclosure_pk.zkey \
		build/verification_key_disclosure.json
	cd build && sha256sum disclosure_js/disclosure.wasm verification_key_disclosure.json > ../release/checksums.txt
	cd keys && sha256sum disclosure_pk.zkey >> ../release/checksums.txt
	@echo "✅ Release artifacts created in release/"

# Run everything (full workflow)
all: clean install build test bench
	@echo "✅ All operations complete"

# Development workflow
dev: install build test
	@echo "✅ Development environment ready"
