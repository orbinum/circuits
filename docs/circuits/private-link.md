# Private Link Dispatch Circuit

**File**: [`circuits/private_link.circom`](../../circuits/private_link.circom)

## Purpose

The Private Link circuit proves knowledge of the preimage of a commitment stored in `pallet-account-mapping`, without revealing the external wallet address. It enables users to execute cross-chain calls by proving ownership of a private link between their Orbinum account and an external chain address, while keeping the address itself hidden.

## Circuit Statement

> "I know the chain_id and external address whose Poseidon commitment is stored on-chain, and I'm binding this proof to a specific call"

## Security Properties

- **Privacy**: The external `address_fe` is never revealed on-chain
- **Soundness**: Cannot forge a proof without knowing the actual preimage
- **Replay Prevention**: The proof is bound to a specific `call_hash_fe`, preventing it from being replayed for a different call
- **Binding**: Proof is cryptographically tied to the specific on-chain commitment

## Commitment Scheme

The commitment scheme mirrors the Rust implementation in `reveal_private_link`:

```
inner      = Poseidon(chain_id_fe, address_fe)
commitment = Poseidon(inner, blinding_fe)
```

### Field Encoding

Inputs must be encoded as BN254 field elements using `Fr::from_le_bytes_mod_order` (matching the Rust pallet):

| Signal         | Encoding                                                        |
| -------------- | --------------------------------------------------------------- |
| `chain_id_fe`  | `BigInt(chain_id)` — fits in u32, always `< p`                  |
| `address_fe`   | Address bytes zero-padded right to 32 bytes, LE integer mod `p` |
| `blinding_fe`  | 32-byte random scalar, LE integer mod `p`, must be `< p`        |
| `call_hash_fe` | `blake2_256(SCALE-encoded call)` as LE BN254 field element      |

## Public Inputs (Visible On-Chain)

| Input          | Type  | Description                                                |
| -------------- | ----- | ---------------------------------------------------------- |
| `commitment`   | Field | Stored on-chain in `PrivateChainLinks`                     |
| `call_hash_fe` | Field | `blake2_256(SCALE-encoded call)` as LE BN254 field element |

## Private Inputs (Known Only to Prover)

| Input         | Type  | Description                                        |
| ------------- | ----- | -------------------------------------------------- |
| `chain_id_fe` | Field | Chain ID encoded as a BN254 field element          |
| `address_fe`  | Field | External wallet address encoded as a field element |
| `blinding_fe` | Field | 32-byte random blinding scalar                     |

## Constraints

### 1. Commitment Verification

Proves that the private inputs produce the on-chain commitment via nested Poseidon hashing.

```
inner      = Poseidon(chain_id_fe, address_fe)
commitment = Poseidon(inner, blinding_fe)
```

**Circuit Logic**:

```circom
component h1 = Poseidon(2);
h1.inputs[0] <== chain_id_fe;
h1.inputs[1] <== address_fe;

component h2 = Poseidon(2);
h2.inputs[0] <== h1.out;
h2.inputs[1] <== blinding_fe;

commitment === h2.out;
```

### 2. Call Hash Binding

Binds the proof to a specific call to prevent replay attacks across different calls.

```circom
signal call_hash_sq;
call_hash_sq <== call_hash_fe * call_hash_fe;
```

**Why quadratic?** A linear constraint on `call_hash_fe` would be eliminated by the `--O1` simplification pass, giving it a zero coefficient in `gamma_abc`. This would make the proof replayable across different calls. The quadratic constraint forces `call_hash_fe` to participate in the R1CS system meaningfully.

## Circuit Parameters

- **Constraints**: ~5
- **Public Inputs**: 2 (`commitment`, `call_hash_fe`)
- **Private Inputs**: 3 (`chain_id_fe`, `address_fe`, `blinding_fe`)
- **Proving Time**: <50ms (local machine)
- **Verification Time**: <5ms

## Usage Example

```typescript
import { buildPoseidon } from "circomlibjs";

const poseidon = await buildPoseidon();

// Encode address as LE field element (32 bytes, zero-padded right, mod p)
const addressBytes = Buffer.alloc(32);
Buffer.from(externalAddress.slice(2), "hex").copy(addressBytes);
const address_fe = BigInt("0x" + addressBytes.reverse().toString("hex")) % FIELD_MODULUS;

// Encode chain_id
const chain_id_fe = BigInt(chainId);

// Compute commitment (must match on-chain value)
const inner = poseidon([chain_id_fe, address_fe]);
const commitment = poseidon([inner, blinding_fe]);

// Compute call hash
const callHash = blake2_256(scaleEncode(call));
const callHashBytes = Buffer.from(callHash);
const call_hash_fe = BigInt("0x" + callHashBytes.reverse().toString("hex")) % FIELD_MODULUS;

const input = {
    // Public
    commitment: commitment,
    call_hash_fe: call_hash_fe,

    // Private
    chain_id_fe: chain_id_fe,
    address_fe: address_fe,
    blinding_fe: blinding_fe,
};
```

## Security Considerations

### Blinding Factor

The blinding factor (`blinding_fe`) must be:

- A cryptographically random 32-byte scalar
- Strictly less than the BN254 field modulus `p`
- Never reused across different links

### Commitment Storage

The on-chain commitment in `PrivateChainLinks` must be set before generating a proof. The commitment binds the prover to a specific `(chain_id, address)` pair.

### Replay Attacks

The `call_hash_fe` binding ensures a valid proof for one call cannot be submitted for a different call. The runtime must verify that `call_hash_fe` matches the actual submitted extrinsic.

### Field Encoding Consistency

The field encoding of `chain_id_fe` and `address_fe` **must** match `Fr::from_le_bytes_mod_order` from the Rust pallet exactly. Any deviation will produce a different commitment and cause proof verification to fail.

## Build Artifacts

```bash
pnpm run full-build:private-link
```

Produces:

- `build/private_link.r1cs`
- `build/private_link_js/` (witness calculator)
- `keys/private_link_pk.zkey` (proving key)
- `build/verification_key_private_link.json`
- `keys/private_link_pk.ark` (Rust proving key)

## Related Documentation

- [Note Circuit](note.md) - NoteCommitment and Nullifier primitives
- [Poseidon Wrapper](poseidon-wrapper.md) - Poseidon hash used in commitment scheme
- [Arkworks Integration Guide](../guides/arkworks-integration.md)
