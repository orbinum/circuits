# Changelog

All notable changes to Orbinum Circuits will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-03-07

### Added

- **Circuit**: `private_link.circom` — nuevo circuito `PrivateLinkDispatch` para la operación `dispatch_as_private_link` en `pallet-account-mapping`.
    - 487 restricciones no lineales (dos llamadas Poseidon(2) + constraint cuadrático de call_hash)
    - 2 inputs públicos: `commitment` y `call_hash_fe`
    - 3 inputs privados: `chain_id_fe`, `address_fe`, `blinding_fe`
    - Esquema de commitment: `Poseidon2(Poseidon2(chain_id_fe, address_fe), blinding_fe)`
    - Fix de seguridad crítico: constraint cuadrático `call_hash_sq <== call_hash_fe * call_hash_fe` para sobrevivir a la simplificación lineal `--O1` y prevenir ataques de replay.
- **Scripts CI**: `compile:private-link`, `setup:private-link`, `full-build:private-link`, `convert:private-link` en `package.json`.
- **build-all.sh**: `private_link` añadido al array `CIRCUITS` — incluido en `npm run build-all`.
- **CI/CD** (`release.yml`): `private_link` incluido en todas las fases del pipeline de release:
    - Conversión `.zkey` → `.ark`
    - Generación de checksums
    - Empaquetado en los tres archivos tar (arkworks, snarkjs, verification-keys)
    - Paquete npm (`pkg/`)
- **Tests de circuito** (`test/private_link.test.ts`): 15 tests — validación del esquema Poseidon y restricciones R1CS.
- **VK embebida en runtime** (`primitives/zk-verifier/src/infrastructure/storage/verification_keys/private_link.rs`): VK Groth16/BN254 generada con el trusted setup de desarrollo, cargada en genesis.
- **Tests Rust de VK** (`orbinum-zk-verifier`): 5 tests que validan estructura de la VK (puntos en curva, round-trip de serialización, conteo de IC points).
- **`scripts/utils/check-artifacts.ts`** — herramienta de comparación de artifacts:
    - Compara SHA-256 de los artifacts locales contra CDN (`circuits.orbinum.io/v1`) y npm (`@orbinum/circuits`)
    - Detecta qué circuitos están desactualizados en cada fuente
    - Flag `--build` para compilar todo antes de comparar
    - Flags `--cdn-only` / `--npm-only` para consultas parciales
    - Exit code 1 si hay desactualizados (útil en CI)
    - Comandos: `npm run check-artifacts`, `check-artifacts:build`, `check-artifacts:cdn`, `check-artifacts:npm`

### Changed

- **package.json**: versión bump `0.3.1` → `0.4.0`.
- **CI/CD** (`release.yml`): workflow restringido a branches `main` y `develop`.

## [0.3.1] - 2026-02-18

### Added

- **CDN**: Automated deployment of circuit artifacts to Cloudflare R2 (`circuits.orbinum.io`) via CI/CD.

### Changed

- **Configuration**: Updated default circuit URL in `proof-generator` to point to the new global CDN.

## [0.3.0] - 2026-02-16

### Added

- **npm package distribution**: Added npm packaging assets under `npm/`:
    - `npm/package.json.template`
    - `npm/index.js`
    - `npm/index.d.ts`
    - `npm/README.md`
- **Release automation for npm**: Added release workflow steps to assemble `pkg/` and publish `@orbinum/circuits` to npm from CI.
- **Local package preparation target**: Added `make prepare-npm` to build a local `pkg/` package structure for validation before release.

### Changed

- **Release pipeline**: `.github/workflows/release.yml` now prepares npm-ready artifacts from circuit outputs (`.wasm`, `.zkey`, `.ark`, `verification_key_*.json`) and publishes with `NPM_TOKEN`.
- **Repository docs**: Updated `README.md` to document npm installation (`npm install @orbinum/circuits`) and package-based consumption.
- **Ignore rules**: Added `pkg/` to `.gitignore` because it is now a generated release/package directory.
- **Cleanup behavior**: Updated clean targets to include generated package/release working directories used for npm packaging.
- **Disclosure test behavior**: `test/disclosure.test.ts` now skips suites that require precompiled artifacts when `build/disclosure_js` is missing, instead of failing in environments where `make build` has not been run.
- **Commit hook scope**: `.husky/pre-commit` no longer runs `npm test`; it now executes only staged format/lint checks via `lint-staged`.

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
