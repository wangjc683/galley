//! Galley remote access wire formats, shared by Galley Core (the desktop
//! end), the relay, and — as golden fixtures — the iOS app.
//!
//! Design: `.scratch/ios-client/issues/05-remote-protocol-design.md`
//! (cited below as "design §N"). Layers, outermost first:
//!
//! | Module | What | Design |
//! |---|---|---|
//! | [`keys`] | pairing master key, HKDF-derived keys, channel key, QR string | §3.1 |
//! | [`frame`] | relay frames (WebSocket binary messages) | §4.2 |
//! | [`noise`] | `Noise_NNpsk0_25519_ChaChaPoly_SHA256` handshake and transport records | §5 |
//! | [`padding`] | length prefix + zero padding inside every Noise plaintext | §5 |
//! | [`push`] | push content sealed with `push_key` for the APNs `g` field | §4.3 |
//! | [`app`] | end-to-end JSON protocol: envelope, methods, events, chunking | §6 |
//!
//! The relay depends on [`frame`] (and [`keys`] for the channel key) only;
//! it never holds a key that opens [`noise`] or [`push`] traffic. Nothing
//! here does I/O: no sockets, no tokio, no Tauri, no Galley Core.

#![forbid(unsafe_code)]

pub mod app;
pub mod frame;
pub mod keys;
pub mod noise;
pub mod padding;
pub mod push;
