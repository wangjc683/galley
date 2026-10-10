//! Plaintext padding (design §5 "不压缩，只填充").
//!
//! The relay sees every ciphertext's length, and agent output mixes
//! attacker-chosen web content with private data, so lengths are coarsened
//! instead of compressed. A padded buffer is
//!
//! ```text
//! len u16 (big-endian) ‖ payload (len bytes) ‖ zero bytes
//! ```
//!
//! and its total size is a function of `len` alone:
//! `max(256, Padmé(2 + len))`, capped at [`MAX_PLAINTEXT_LEN`] (the Noise
//! message limit minus the AEAD tag). Padmé (Nikitin et al., PoPETs 2019)
//! rounds up by dropping low mantissa bits, so the overhead stays under
//! 12% and a length leaks only O(log log n) bits.
//!
//! [`unpad`] is strict: the buffer must be exactly the canonical size for
//! its declared length and every padding byte must be zero. Changing the
//! size rule is therefore a protocol change (the Noise prologue version,
//! [`crate::noise::PROLOGUE_TAG`]). [`pad_to`] / [`unpad_exact`] are the
//! same format at a fixed size, used by [`crate::push`].

use std::fmt;

/// Noise's message limit (Noise spec §3).
pub const MAX_NOISE_MESSAGE_LEN: usize = 65535;
/// ChaChaPoly tag appended to every encrypted Noise payload.
pub const AEAD_TAG_LEN: usize = 16;
/// Largest plaintext one Noise transport message can carry.
pub const MAX_PLAINTEXT_LEN: usize = MAX_NOISE_MESSAGE_LEN - AEAD_TAG_LEN;
/// Floor of every padded size.
pub const MIN_PADDED_LEN: usize = 256;
/// The `u16` length prefix.
pub const LEN_PREFIX: usize = 2;
/// Largest payload [`pad`] accepts.
pub const MAX_PAYLOAD_LEN: usize = MAX_PLAINTEXT_LEN - LEN_PREFIX;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaddingError {
    /// Payload does not fit the target size.
    TooLarge {
        len: usize,
        max: usize,
    },
    /// Shorter than the length prefix.
    Truncated,
    /// Declared length runs past the buffer.
    LengthOutOfRange {
        declared: usize,
        available: usize,
    },
    /// Buffer size is not the canonical size for the declared length.
    NonCanonicalSize {
        expected: usize,
        actual: usize,
    },
    NonZeroPadding,
}

impl fmt::Display for PaddingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PaddingError::TooLarge { len, max } => {
                write!(f, "payload of {len} bytes exceeds {max}")
            }
            PaddingError::Truncated => f.write_str("padded buffer shorter than its length prefix"),
            PaddingError::LengthOutOfRange {
                declared,
                available,
            } => write!(f, "declared length {declared} exceeds {available} bytes"),
            PaddingError::NonCanonicalSize { expected, actual } => {
                write!(f, "padded size {actual} is not the canonical {expected}")
            }
            PaddingError::NonZeroPadding => f.write_str("padding bytes are not zero"),
        }
    }
}

impl std::error::Error for PaddingError {}

/// Padmé: round `len` up so only its top `floor(log2 E) + 1` mantissa bits
/// may be nonzero, `E = floor(log2 len)`. `padme(0) = 0`, `padme(1) = 1`.
pub fn padme(len: usize) -> usize {
    if len < 2 {
        return len;
    }
    let e = usize::BITS - 1 - len.leading_zeros(); // floor(log2 len) >= 1
    let s = u32::BITS - 1 - e.leading_zeros() + 1; // floor(log2 e) + 1
    let last_bits = e - s.min(e);
    let mask = (1usize << last_bits) - 1;
    (len + mask) & !mask
}

/// Canonical padded size for a payload of `payload_len` bytes, or `None`
/// if it cannot fit one Noise message.
pub fn padded_len(payload_len: usize) -> Option<usize> {
    if payload_len > MAX_PAYLOAD_LEN {
        return None;
    }
    let needed = LEN_PREFIX + payload_len;
    Some(padme(needed).clamp(MIN_PADDED_LEN, MAX_PLAINTEXT_LEN))
}

/// Pad to the canonical size ([`padded_len`]).
pub fn pad(payload: &[u8]) -> Result<Vec<u8>, PaddingError> {
    let total = padded_len(payload.len()).ok_or(PaddingError::TooLarge {
        len: payload.len(),
        max: MAX_PAYLOAD_LEN,
    })?;
    pad_to(payload, total)
}

/// Strict inverse of [`pad`]; returns the payload.
pub fn unpad(buf: &[u8]) -> Result<&[u8], PaddingError> {
    let declared = declared_len(buf)?;
    // `declared_len` bounds `declared` by the buffer, which is at most one
    // Noise plaintext when it came from a Noise message.
    let expected = padded_len(declared).ok_or(PaddingError::TooLarge {
        len: declared,
        max: MAX_PAYLOAD_LEN,
    })?;
    if buf.len() != expected {
        return Err(PaddingError::NonCanonicalSize {
            expected,
            actual: buf.len(),
        });
    }
    payload_after_zero_check(buf, declared)
}

/// Pad to exactly `total` bytes (`total` at most `u16::MAX + 2`).
pub fn pad_to(payload: &[u8], total: usize) -> Result<Vec<u8>, PaddingError> {
    let max = total.saturating_sub(LEN_PREFIX).min(usize::from(u16::MAX));
    if payload.len() > max {
        return Err(PaddingError::TooLarge {
            len: payload.len(),
            max,
        });
    }
    let mut out = Vec::with_capacity(total);
    // Bounded by `max` above.
    out.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    out.extend_from_slice(payload);
    out.resize(total, 0);
    Ok(out)
}

/// Strict inverse of [`pad_to`] at a known size.
pub fn unpad_exact(buf: &[u8], total: usize) -> Result<&[u8], PaddingError> {
    if buf.len() != total {
        return Err(PaddingError::NonCanonicalSize {
            expected: total,
            actual: buf.len(),
        });
    }
    let declared = declared_len(buf)?;
    payload_after_zero_check(buf, declared)
}

fn declared_len(buf: &[u8]) -> Result<usize, PaddingError> {
    if buf.len() < LEN_PREFIX {
        return Err(PaddingError::Truncated);
    }
    let declared = usize::from(u16::from_be_bytes([buf[0], buf[1]]));
    let available = buf.len() - LEN_PREFIX;
    if declared > available {
        return Err(PaddingError::LengthOutOfRange {
            declared,
            available,
        });
    }
    Ok(declared)
}

fn payload_after_zero_check(buf: &[u8], declared: usize) -> Result<&[u8], PaddingError> {
    let (payload, padding) = buf[LEN_PREFIX..].split_at(declared);
    if padding.iter().any(|&b| b != 0) {
        return Err(PaddingError::NonZeroPadding);
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn padme_matches_the_paper() {
        // Values from the PURBs paper's definition, checked by hand.
        let cases = [
            (0, 0),
            (1, 1),
            (2, 2),
            (3, 3),
            (9, 10),
            (257, 272),
            (300, 304),
            (1000, 1024),
            (5000, 5120),
            (65519, 65536),
        ];
        for (len, want) in cases {
            assert_eq!(padme(len), want, "padme({len})");
        }
        for len in 2..70_000usize {
            let p = padme(len);
            assert!(p >= len);
            assert!((p - len) * 100 <= len * 12, "overhead above 12% at {len}");
            assert_eq!(padme(p), p, "padme is idempotent at {len}");
        }
    }

    #[test]
    fn padded_sizes() {
        assert_eq!(padded_len(0), Some(256));
        assert_eq!(padded_len(254), Some(256));
        assert_eq!(padded_len(255), Some(272));
        assert_eq!(padded_len(MAX_PAYLOAD_LEN), Some(MAX_PLAINTEXT_LEN));
        assert_eq!(padded_len(MAX_PAYLOAD_LEN + 1), None);
        let mut prev = 0;
        for len in 0..=MAX_PAYLOAD_LEN {
            let total = padded_len(len).unwrap();
            assert!(total >= len + LEN_PREFIX && total <= MAX_PLAINTEXT_LEN);
            assert!(total >= prev, "padded size is monotonic");
            prev = total;
        }
    }

    #[test]
    fn round_trip() {
        for len in [0, 1, 200, 254, 255, 1000, 40_000, MAX_PAYLOAD_LEN] {
            let payload: Vec<u8> = (0..len).map(|i| (i % 251) as u8 + 1).collect();
            let padded = pad(&payload).unwrap();
            assert_eq!(padded.len(), padded_len(len).unwrap());
            assert_eq!(unpad(&padded).unwrap(), &payload[..]);
        }
        assert!(matches!(
            pad(&vec![0; MAX_PAYLOAD_LEN + 1]),
            Err(PaddingError::TooLarge { .. })
        ));
    }

    #[test]
    fn unpad_is_strict() {
        let padded = pad(b"hello").unwrap();
        assert_eq!(unpad(&[]), Err(PaddingError::Truncated));
        assert_eq!(unpad(&[0]), Err(PaddingError::Truncated));
        let mut nonzero = padded.clone();
        nonzero[255] = 1;
        assert_eq!(unpad(&nonzero), Err(PaddingError::NonZeroPadding));
        let mut long_len = padded.clone();
        long_len[0] = 0x01;
        assert_eq!(
            unpad(&long_len),
            Err(PaddingError::LengthOutOfRange {
                declared: 0x0105,
                available: 254
            })
        );
        assert_eq!(
            unpad(&padded[..200]),
            Err(PaddingError::NonCanonicalSize {
                expected: 256,
                actual: 200
            })
        );
        let mut longer = padded.clone();
        longer.push(0);
        assert!(matches!(
            unpad(&longer),
            Err(PaddingError::NonCanonicalSize { .. })
        ));
    }

    #[test]
    fn fixed_size_variant() {
        let padded = pad_to(b"abc", 64).unwrap();
        assert_eq!(padded.len(), 64);
        assert_eq!(unpad_exact(&padded, 64).unwrap(), b"abc");
        assert!(unpad_exact(&padded, 65).is_err());
        assert!(pad_to(&[0; 63], 64).is_err());
        assert_eq!(pad_to(&[1; 62], 64).unwrap().len(), 64);
    }
}
