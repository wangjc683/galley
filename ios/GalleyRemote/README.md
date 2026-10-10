# GalleyRemote

The phone side of Galley's remote-access wire protocol, as a Swift
package: everything the iOS app (ticket 07) and its Notification Service
Extension need to talk to Galley Core through the relay, byte-for-byte
compatible with the Rust crate [`remote-protocol`](../../remote-protocol/)
that Core and the relay use. Pure Swift on Apple CryptoKit, no third-party
dependencies, no UI, no networking.

Design and rationale:
[05 / 06 remote protocol design](../../.scratch/ios-client/issues/05-remote-protocol-design.md)
(cited in the code as "design §N"). Ruling 2 of its §12 chose to write
Noise on CryptoKit primitives rather than vendor a library or bind the
Rust code.

## Layout

| Path | What | Rust counterpart | Design |
|---|---|---|---|
| `Sources/GalleyRemote/Keys.swift` | master key, HKDF-SHA256 derived keys (channel secret, Noise PSK, push key), channel key, strict pairing QR and relay URL parsing | `keys` | §3.1 |
| `Sources/GalleyRemote/Frame.swift` | relay frames `DATA`, `PEER`, `PUSH`, `PUSH_RESULT`, `PING`, `PONG` with the same strictness and error labels | `frame` | §4.2 |
| `Sources/GalleyRemote/Noise/CipherState.swift`, `HandshakeState.swift` | Noise rev 34 CipherState / SymmetricState / HandshakeState, generic over patterns; `NNpsk0`, `XXpsk3`, `KK` in `25519_ChaChaPoly_SHA256` | snow 0.10.0 | §5 |
| `Sources/GalleyRemote/Noise/Session.swift` | the phone's session: prologue, handshake request (48 bytes), Core's hello, `APP` / `CLOSE` records | `noise` | §5 |
| `Sources/GalleyRemote/Padding.swift` | `u16` length ‖ payload ‖ zeros, `max(256, Padmé)`, strict unpad | `padding` | §5 |
| `Sources/GalleyRemote/Push.swift` | opening (and, for tests, sealing) the APNs `g` field | `push` | §4.3 |
| `Sources/GalleyRemote/App/` | envelope (`req` / `res` / `evt` / `chunk`), every P0 method's params and result, event payloads, chunking and reassembly | `app` | §6 |

How the Noise primitives map onto CryptoKit:

- DH: `Curve25519.KeyAgreement` (X25519, raw 32-byte keys).
- Cipher: `ChaChaPoly`; the nonce is 4 zero bytes followed by the 64-bit
  counter, little-endian (Noise §12.3). A failed decrypt does not advance
  the counter, and `n = 2^64 - 1` is refused (§5.1).
- Hash: `SHA256` and `HMAC<SHA256>`. Noise's `HKDF` is its own §4.3
  construction over HMAC (outputs chained with a counter byte, no info),
  not RFC 5869; CryptoKit's `HKDF<SHA256>` (RFC 5869) only derives the
  pairing keys of `Keys.swift`, as Rust's `hkdf` crate does.

Fixed-ephemeral entry points (`clientStartWithFixedEphemeralForTestingOnly`
and the host side of the handshake) are `internal`, reachable from the
tests through `@testable import` and from nothing else.

## Tests

```bash
swift test --package-path ios/GalleyRemote      # with Xcode (CI)
ios/GalleyRemote/swift-test.sh                  # any Mac, also Command Line Tools only
```

With only the Command Line Tools installed, SwiftPM 6.2 does not put the
tools' `Testing.framework` on the test target's search path (`no such
module 'Testing'`), and the framework's `_Testing_Foundation`
cross-import overlay ships without a module; `swift-test.sh` adds the
paths and turns cross-import overlays off in that case, and is plain
`swift test` otherwise. The tests use Swift Testing (`import Testing`),
which needs no Xcode.

The tests read the Rust crate's fixtures in place (located from
`#filePath`; there is no copy here):

- `remote-protocol/tests/vectors/cacophony-subset.json`: all three
  vendored vectors byte for byte, through the generic handshake, plus the
  NNpsk0 vector through the session builder.
- `remote-protocol/tests/golden/*.json`: keys and QR (including the
  rejected QR strings, compared with Rust's error `Debug` text), frame
  bytes and error labels, padding sizes, the fixed-ephemeral Noise session
  (both handshake messages, both `APP` records and the `CLOSE`), the
  fixed-nonce push (content JSON, padded plaintext, `g`, APNs payload),
  and every app protocol sample decoded into its Swift type and encoded
  back (compared as JSON values).

The golden tests are also the drift check between the two sides
(design §10): a fixture file, top-level section, field, enum value,
method or event the Swift side does not mirror fails them. When the Rust
side changes a wire format on purpose, it regenerates the fixtures
(`GALLEY_UPDATE_GOLDEN=1`, see the crate's README) and this package
follows until `swift test` passes again.

The remaining tests mirror the Rust crate's unit tests (accept / reject
sets of the QR and relay URL parsers, frame truncation and field rules,
padding strictness, Noise tampering / replay / reordering, push field
rules and truncation, envelope strictness, chunk stream limits).

CI: [`.github/workflows/ios-protocol.yml`](../../.github/workflows/ios-protocol.yml),
on changes under `ios/` or `remote-protocol/`.

## Differences from the Rust crate

- Swift decodes JSON with Foundation's `JSONDecoder`, so a few inputs no
  Galley end produces are read more leniently than serde_json would: an
  integer written as `1.0` or `1e2` decodes as an integer, and a
  duplicated object key keeps its first value instead of failing. Field
  presence, `null` handling, unknown fields and enum values follow Rust
  exactly. Test cases marked "Swift-side extras" go beyond the Rust unit
  tests; their expected results were checked once against the Rust crate
  by hand (07a), not in CI.
- `ClientHandshake` and `Transport` are classes: Rust's move semantics
  (`finish(self)`, a `Transport` that is not `Clone`) become "a second
  `finish` throws" and "a session cannot be copied".
- The host side of the handshake exists only for the tests; the phone is
  always the initiator.
- Push content is serialized by hand (`PushContent.jsonBytes()`) in
  serde_json's field order and escapes, because the padded plaintext of a
  push must match Rust's bytes exactly.
