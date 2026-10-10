# galley-remote-protocol

The wire formats of Galley's remote access, in one pure-Rust crate that
Galley Core (the desktop end), the relay, and — through golden fixtures —
the iOS app all build on. No I/O, no tokio, no Tauri, no dependency on
Galley Core, so the relay can depend on it alone.

Design and rationale:
[05 / 06 remote protocol design](../.scratch/ios-client/issues/05-remote-protocol-design.md)
(cited in the code as "design §N").

## Modules

| Module | What | Design |
|---|---|---|
| `keys` | pairing master key, HKDF-SHA256 derived keys (channel secret, Noise PSK, push key), channel key, strict pairing QR string | §3.1 |
| `frame` | relay frames: `DATA`, `PEER`, `PUSH`, `PUSH_RESULT`, `PING`, `PONG` (byte layouts in the module docs) | §4.2 |
| `noise` | `Noise_NNpsk0_25519_ChaChaPoly_SHA256` over snow 0.10.0: prologue, two-message handshake, `APP` / `CLOSE` transport records | §5 |
| `padding` | `u16` length ‖ payload ‖ zeros, sized `max(256, Padmé(n))` | §5 |
| `push` | push content sealed with ChaCha20-Poly1305 for the APNs `g` field; the APNs payload stays under 4096 bytes | §4.3 |
| `app` | JSON envelope (`req` / `res` / `evt` / `chunk`), protocol version, typed params / results of every P0 method, event payloads, chunking and reassembly | §6 |

Who uses what: the relay needs `frame`, `keys::ChannelSecret` and
`push::apns_payload`; Core and the phone use everything.

## Tests

```bash
cargo test --manifest-path core/Cargo.toml -p galley-remote-protocol
```

- `tests/cacophony.rs`: the vendored Noise test vectors
  (`tests/vectors/`, provenance and license in its README).
- `tests/golden.rs`: the golden fixtures in `tests/golden/` — key
  derivation and QR, frame bytes, padding sizes, a fixed-ephemeral Noise
  session, a fixed-nonce push, and one JSON sample per method and event.
  The Swift package (ticket 07a) decodes the same files.

When a wire format change is intended, regenerate the fixtures and review
the diff:

```bash
GALLEY_UPDATE_GOLDEN=1 cargo test --manifest-path core/Cargo.toml -p galley-remote-protocol --test golden
```

The `test-hooks` feature (fixed Noise ephemeral key, fixed push nonce)
exists only for these fixtures. The crate's own tests enable it through a
self dev-dependency; Core and the relay never do.
