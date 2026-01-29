# Changelog

All notable changes to Orbinum Circuits will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pre-commit hooks with husky and lint-staged
- Automated code formatting with Prettier
- Conventional Commits validation
- Comprehensive architecture documentation
- Circom file linting script

### Changed

- Improved build script output formatting
- Consolidated script messages for better UX
- Silenced verbose snarkJS logs
- Aligned all script borders to 58 characters

### Fixed

- Build artifacts now properly overwrite previous versions
- Removed duplicate "Generated Artifacts" messages

## [0.1.0] - 2026-01-28

### Added

- Initial release of Orbinum Circuits
- Disclosure circuit with selective disclosure features
- Transfer circuit for private transactions
- Unshield circuit for multi-asset support
- Automated build pipeline (`build-all.sh`)
- Comprehensive test suite (86 tests)
- Performance benchmarking framework
- End-to-end testing scripts
- Circuit compilation scripts
- Trusted setup automation
- Powers of Tau download and caching
- Witness generation utilities
- Proof generation and verification
- TypeScript support for all scripts
- Mocha/Chai testing framework
- Circom 2.0 compatibility

### Circuit Details

#### Disclosure Circuit

- Constraints: 1,584
- Inputs: 8 private, 4 public
- Features: Selective disclosure with 4 modes
- Merkle depth: 20 levels
- Hash function: Poseidon

#### Transfer Circuit

- Private asset transfers
- Note commitment scheme
- Merkle proof verification
- EdDSA signature support

#### Unshield Circuit

- Multi-asset unshielding
- Value range proofs
- Asset type validation

### Documentation

- README with quick start guide
- Circuit-specific documentation
- Build pipeline documentation
- Testing guidelines
- Benchmarking instructions

### Infrastructure

- Node.js ≥18.0.0 requirement
- TypeScript 5.3+ support
- Git ignore configuration
- npm package configuration
- CircomLib integration

## Release Notes

### Version 0.1.0

This is the initial release of Orbinum Circuits, extracted from the main Orbinum blockchain repository to facilitate independent development and release management.

**Key Features**:

- Production-ready circuit definitions
- Automated build and setup process
- Comprehensive testing framework
- Performance benchmarking

**Security Notice**:
⚠️ This release uses a **development trusted setup** only. The proving keys generated are **NOT SECURE** for production use. A multi-party trusted setup ceremony with 50+ participants is required before deploying to mainnet.

**Integration**:

- **Wallet CLI**: Use WASM + .zkey files for client-side proof generation
- **Substrate Runtime**: Verifying keys to be embedded in `primitives/zk-verifier/src/vk/`

**System Requirements**:

- Node.js ≥18.0.0
- circom compiler 2.2.3+
- snarkjs 0.7.0+
- 4GB RAM minimum (8GB recommended)
- 2GB free disk space

**Known Limitations**:

- Single-circuit proving (no proof composition yet)
- Development trusted setup only
- No formal verification performed
- Limited constraint optimization

**Next Steps**:

1. Professional security audit (Q2 2026)
2. Multi-party trusted setup ceremony (Q3 2026)
3. Constraint optimization (~20% reduction target)
4. PLONK proof system support
5. Recursive proof composition

---

## Version History

| Version | Release Date | Breaking Changes | Notes         |
| ------- | ------------ | ---------------- | ------------- |
| 0.1.0   | 2026-01-28   | N/A (initial)    | First release |

## Upgrade Guide

### From: None (Initial Release)

### To: 0.1.0

This is the initial release. No upgrade needed.

---

## Note on Contributions

This project is not currently accepting external contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for more information.
