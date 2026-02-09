# Changelog

All notable changes to Orbinum Circuits will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-02-09

### Changed

- **Release Format**: Restructured release assets into 3 separate archives for better usability
    - `orbinum-circuits-{version}.tar.gz`: Arkworks files (.wasm + .ark) for Rust/Substrate (~22 MB)
    - `orbinum-circuits-snarkjs-{version}.tar.gz`: snarkjs files (.zkey) for JavaScript/TypeScript (~24 MB)
    - `orbinum-verification-keys-{version}.tar.gz`: Verification keys (.json) for on-chain validation (~10 KB)
- All files are now extracted to the root directory (no nested folders) for easier integration
- Improved CI/CD workflow for reliable .ark file generation

## [0.2.0] - 2026-02-08

### Fixed

- **CRITICAL**: Increased value range check from u64 to u128 in `unshield.circom` and `transfer.circom`
    - Changed `Num2Bits(64)` to `Num2Bits(128)` to match runtime Balance type
    - Previous limit: ~18.4 ORB maximum per transaction
    - New limit: ~340 undecillion ORB (full u128 range)
    - Affects: Unshield and Private Transfer operations
    - Impact: Users can now transact with realistic amounts without artificial circuit limitations
    - **BREAKING CHANGE**: Requires recompilation of all circuits and regeneration of artifacts

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
