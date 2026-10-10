# Vendored Noise test vectors

`cacophony-subset.json` holds three entries of the cacophony test vector
file, unchanged except for whitespace and the dropped entries:

- `Noise_NNpsk0_25519_ChaChaPoly_SHA256` — the P0 handshake
- `Noise_XXpsk3_25519_ChaChaPoly_SHA256` — P1 pairing (design §3.2)
- `Noise_KK_25519_ChaChaPoly_SHA256` — P1 sessions (design §3.2)

Provenance:

- Source: <https://github.com/haskell-cryptography/cacophony>, file
  `vectors/cacophony.txt` (944 vectors, JSON despite the extension).
- Fetched 2026-10-10 at commit `8ee9d41e34a1a596cfa3ab12aa4069ff87dc1247`
  (repository HEAD, 2025-01-09). The file itself last changed in
  `18b7348c54fd61fcd0c220298883de0d09c8364d` (2018-12-16).
- SHA-256 of the full upstream file:
  `3bde7c09a6f349ee11c825c50fcc02649f8f02a47c857a459206b357f9386cae`.
- License: The Unlicense (public domain dedication), per the repository's
  `LICENSE`; vendoring is allowed.

Format: the noise_wiki test-vector JSON
(<https://github.com/noiseprotocol/noise_wiki/wiki/Test-vectors>).
Handshake messages alternate initiator / responder starting with the
initiator; transport messages keep alternating.

`tests/cacophony.rs` runs all three against snow; the NNpsk0 entry also
runs through the crate's own session builder (`src/noise.rs`). The Swift
package (ticket 07a) runs the same file.
