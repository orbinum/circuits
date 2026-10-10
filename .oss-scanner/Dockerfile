# Anthropic OSS Scanner build image for https://github.com/orbinum/circuits.
# Built online with the repository as context; the scan then runs offline, so circom,
# node_modules, compiled circuits, ceremony keys and pack-verifying-key must all exist
# once this file finishes. Mirrors the "Build & Test" job in .github/workflows/ci.yml.
FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    CIRCOM_VERSION=v2.2.3 \
    PACK_VERIFYING_KEY_BIN=/usr/local/bin/pack-verifying-key \
    PATH=/root/.cargo/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# circom, same release CI pins (scanner VMs are x86-64)
RUN curl -fsSL -o /usr/local/bin/circom \
      "https://github.com/iden3/circom/releases/download/${CIRCOM_VERSION}/circom-linux-amd64" \
    && chmod +x /usr/local/bin/circom && circom --version

# pack-verifying-key: computes the vk_hash the chain registers (manifest_vk_hash and
# rotation tests). Same toolchain as .github/actions/pack-verifying-key.
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.90.0 \
    && git clone --depth 1 https://github.com/orbinum/groth16-proofs.git /opt/groth16-proofs \
    && cd /opt/groth16-proofs \
    && cargo build --release --bin pack-verifying-key \
    && cp target/release/pack-verifying-key "$PACK_VERIFYING_KEY_BIN"

# pnpm version pinned by package.json "packageManager"
RUN npm install -g pnpm@10.32.1

# scanner contract: the checkout lives at /src
COPY . /src
WORKDIR /src

RUN pnpm install --frozen-lockfile

# Compile every circuit (.r1cs/.wasm/.sym) and regenerate fixtures, no trusted setup.
RUN pnpm run build-all --compile-only

# Published ceremony outputs (zkey, vk json, .ark) from npm; needs network, so do it now.
RUN pnpm run release:restore --keys-only

# Smoke-run the CI test suite; a failure must not abort the image.
RUN pnpm run lint:circom && pnpm run test:strict \
    || echo "WARNING: circuit tests reported failures"
