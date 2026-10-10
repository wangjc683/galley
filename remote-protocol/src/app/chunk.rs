//! Chunking (design §6.1 `chunk`): a message too large for one `APP`
//! record ([`MAX_APP_RECORD_LEN`]) goes as a run of `chunk` messages.
//!
//! Rules:
//! - The sender numbers its chunked messages itself (`id`, unique among
//!   its streams in flight); `i` counts from 0 in steps of 1; `last: true`
//!   ends the stream. Streams may interleave with each other and with
//!   ordinary messages.
//! - Each chunk carries 1..=[`CHUNK_DATA_MAX`] bytes (base64 on the wire,
//!   so a chunk always fits one record).
//! - The joined bytes are one complete message of any type but `chunk`.
//! - A receiver holds at most [`MAX_STREAMS`] streams and
//!   [`MAX_MESSAGE_LEN`] bytes in flight; anything else is an error, and
//!   the stream is dropped. [`MAX_MESSAGE_LEN`] covers the largest legal
//!   send (25 MB of images, base64) with room for its JSON.
//! - A session that ends without `CLOSE` drops all partial streams
//!   ([`Reassembler::clear`]).

use std::collections::HashMap;

use super::{AppError, Chunk, Envelope};
use crate::noise::MAX_APP_RECORD_LEN;

/// Raw bytes per chunk: 48000 bytes is 64000 base64 characters, which
/// with the envelope stays under [`MAX_APP_RECORD_LEN`].
pub const CHUNK_DATA_MAX: usize = 48_000;
/// Largest reassembled message, and the most bytes in flight per receiver.
pub const MAX_MESSAGE_LEN: usize = 40 * 1024 * 1024;
/// Most chunked messages a receiver collects at once.
pub const MAX_STREAMS: usize = 4;

/// Turns messages into `APP` record bodies, chunking the large ones.
#[derive(Debug)]
pub struct Chunker {
    next_id: u64,
}

impl Default for Chunker {
    fn default() -> Self {
        Self::new()
    }
}

impl Chunker {
    pub fn new() -> Self {
        Self { next_id: 1 }
    }

    /// The record bodies for one message, in order: the message itself
    /// when it fits one record, otherwise its chunks.
    pub fn encode(&mut self, envelope: &Envelope) -> Result<Vec<Vec<u8>>, AppError> {
        if matches!(envelope, Envelope::Chunk(_)) {
            return Err(AppError::BadChunk("a chunk cannot be chunked"));
        }
        let json = envelope.to_json();
        if json.len() > MAX_MESSAGE_LEN {
            return Err(AppError::TooLarge {
                limit: MAX_MESSAGE_LEN,
            });
        }
        if json.len() <= MAX_APP_RECORD_LEN {
            return Ok(vec![json]);
        }
        Ok(self.split(&json, CHUNK_DATA_MAX))
    }

    /// Split `json` into chunks of at most `chunk_size` bytes (clamped to
    /// 1..=[`CHUNK_DATA_MAX`]) regardless of its size. [`Chunker::encode`]
    /// is the normal entry; this is public for fixtures and tests.
    pub fn split(&mut self, json: &[u8], chunk_size: usize) -> Vec<Vec<u8>> {
        let chunk_size = chunk_size.clamp(1, CHUNK_DATA_MAX);
        let id = self.next_id;
        self.next_id += 1;
        let count = json.len().div_ceil(chunk_size).max(1);
        json.chunks(chunk_size)
            .enumerate()
            .map(|(index, data)| {
                Envelope::Chunk(Chunk {
                    id,
                    // A message is at most MAX_MESSAGE_LEN bytes, so far
                    // fewer than u32::MAX chunks.
                    index: index as u32,
                    last: index + 1 == count,
                    data: data.to_vec(),
                })
                .to_json()
            })
            .collect()
    }
}

#[derive(Debug)]
struct Stream {
    next_index: u32,
    data: Vec<u8>,
}

/// Collects chunks back into messages.
#[derive(Debug)]
pub struct Reassembler {
    streams: HashMap<u64, Stream>,
    buffered: usize,
    max_message_len: usize,
    max_streams: usize,
}

impl Default for Reassembler {
    fn default() -> Self {
        Self::new()
    }
}

impl Reassembler {
    pub fn new() -> Self {
        Self::with_limits(MAX_MESSAGE_LEN, MAX_STREAMS)
    }

    /// Lower limits, for a receiver with less memory or for tests.
    pub fn with_limits(max_message_len: usize, max_streams: usize) -> Self {
        Self {
            streams: HashMap::new(),
            buffered: 0,
            max_message_len,
            max_streams,
        }
    }

    /// Feed one received message. A chunk is held until its stream ends,
    /// then the joined message comes back; any other message comes back
    /// at once.
    pub fn push(&mut self, envelope: Envelope) -> Result<Option<Envelope>, AppError> {
        let chunk = match envelope {
            Envelope::Chunk(chunk) => chunk,
            other => return Ok(Some(other)),
        };
        if chunk.data.is_empty() || chunk.data.len() > CHUNK_DATA_MAX {
            self.drop_stream(chunk.id);
            return Err(AppError::BadChunk("chunk data size"));
        }
        match self.streams.get(&chunk.id) {
            None if chunk.index != 0 => return Err(AppError::BadChunk("stream must start at 0")),
            None if self.streams.len() >= self.max_streams => {
                return Err(AppError::TooManyStreams {
                    limit: self.max_streams,
                })
            }
            None => {
                self.streams.insert(
                    chunk.id,
                    Stream {
                        next_index: 0,
                        data: Vec::new(),
                    },
                );
            }
            Some(stream) if stream.next_index != chunk.index => {
                self.drop_stream(chunk.id);
                return Err(AppError::BadChunk("chunk out of order"));
            }
            Some(_) => {}
        }
        if self.buffered + chunk.data.len() > self.max_message_len {
            self.drop_stream(chunk.id);
            return Err(AppError::TooLarge {
                limit: self.max_message_len,
            });
        }
        let stream = self
            .streams
            .get_mut(&chunk.id)
            .expect("stream inserted or found above");
        stream.data.extend_from_slice(&chunk.data);
        stream.next_index = stream.next_index.saturating_add(1);
        self.buffered += chunk.data.len();
        if !chunk.last {
            return Ok(None);
        }
        let stream = self
            .streams
            .remove(&chunk.id)
            .expect("stream present above");
        self.buffered -= stream.data.len();
        match Envelope::from_json(&stream.data)? {
            Envelope::Chunk(_) => Err(AppError::BadChunk("a chunk inside a chunk")),
            message => Ok(Some(message)),
        }
    }

    /// Drop every partial stream (the session ended without `CLOSE`).
    pub fn clear(&mut self) {
        self.streams.clear();
        self.buffered = 0;
    }

    /// Bytes held in partial streams.
    pub fn buffered(&self) -> usize {
        self.buffered
    }

    fn drop_stream(&mut self, id: u64) {
        if let Some(stream) = self.streams.remove(&id) {
            self.buffered -= stream.data.len();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{AttachmentRead, AttachmentReadResult, Event, Response};

    fn big_response(bytes: usize) -> Envelope {
        Envelope::Response(Response::ok::<AttachmentRead>(
            5,
            &AttachmentReadResult {
                attachment_id: "a".into(),
                mime_type: "image/png".into(),
                byte_size: bytes as u64,
                data: "A".repeat(bytes),
            },
        ))
    }

    fn feed(r: &mut Reassembler, bodies: &[Vec<u8>]) -> Vec<Envelope> {
        bodies
            .iter()
            .filter_map(|b| r.push(Envelope::from_json(b).unwrap()).unwrap())
            .collect()
    }

    #[test]
    fn small_messages_are_not_chunked() {
        let env = big_response(10);
        let bodies = Chunker::new().encode(&env).unwrap();
        assert_eq!(bodies, vec![env.to_json()]);
    }

    #[test]
    fn large_messages_chunk_and_reassemble() {
        let env = big_response(200_000);
        let bodies = Chunker::new().encode(&env).unwrap();
        assert!(bodies.len() > 4);
        for body in &bodies {
            assert!(body.len() <= MAX_APP_RECORD_LEN);
        }
        let mut r = Reassembler::new();
        assert_eq!(feed(&mut r, &bodies), vec![env]);
        assert_eq!(r.buffered(), 0);
    }

    #[test]
    fn worst_case_chunk_fits_one_record() {
        let json = Envelope::Chunk(Chunk {
            id: u64::MAX,
            index: u32::MAX,
            last: false,
            data: vec![0xff; CHUNK_DATA_MAX],
        })
        .to_json();
        assert!(json.len() <= MAX_APP_RECORD_LEN, "{}", json.len());
    }

    #[test]
    fn interleaved_streams_and_plain_messages() {
        let a = big_response(300);
        let b = big_response(500);
        let mut chunker = Chunker::new();
        let ca = chunker.split(&a.to_json(), 100);
        let cb = chunker.split(&b.to_json(), 100);
        let plain = Envelope::Event(Event {
            name: "x".into(),
            payload: serde_json::json!({}),
        });
        let mut bodies = Vec::new();
        for i in 0..ca.len().max(cb.len()) {
            if let Some(c) = ca.get(i) {
                bodies.push(c.clone());
            }
            if i == 1 {
                bodies.push(plain.to_json());
            }
            if let Some(c) = cb.get(i) {
                bodies.push(c.clone());
            }
        }
        let mut r = Reassembler::new();
        assert_eq!(feed(&mut r, &bodies), vec![plain, a, b]);
    }

    fn chunk(id: u64, index: u32, last: bool, data: &[u8]) -> Envelope {
        Envelope::Chunk(Chunk {
            id,
            index,
            last,
            data: data.to_vec(),
        })
    }

    #[test]
    fn bad_streams_are_rejected() {
        let mut r = Reassembler::new();
        assert!(matches!(
            r.push(chunk(1, 1, false, b"x")),
            Err(AppError::BadChunk(_))
        ));
        assert!(r.push(chunk(1, 0, false, b"x")).unwrap().is_none());
        assert!(matches!(
            r.push(chunk(1, 2, false, b"x")),
            Err(AppError::BadChunk(_))
        ));
        assert_eq!(r.buffered(), 0, "out-of-order drops the stream");
        assert!(matches!(
            r.push(chunk(2, 0, false, b"")),
            Err(AppError::BadChunk(_))
        ));
        assert!(matches!(
            r.push(chunk(2, 0, false, &vec![0; CHUNK_DATA_MAX + 1])),
            Err(AppError::BadChunk(_))
        ));
        // A stream that ends in something that is not a message.
        assert!(r.push(chunk(3, 0, false, b"{\"t\":")).unwrap().is_none());
        assert!(matches!(
            r.push(chunk(3, 1, true, b"1}")),
            Err(AppError::Json(_))
        ));
        // A chunk wrapping a chunk.
        let inner = chunk(9, 0, true, b"x").to_json();
        assert!(matches!(
            r.push(chunk(4, 0, true, &inner)),
            Err(AppError::BadChunk(_))
        ));
    }

    #[test]
    fn limits_are_enforced() {
        let mut r = Reassembler::with_limits(10, 2);
        assert!(r.push(chunk(1, 0, false, b"12345")).unwrap().is_none());
        assert!(r.push(chunk(2, 0, false, b"1234")).unwrap().is_none());
        assert!(matches!(
            r.push(chunk(3, 0, false, b"1")),
            Err(AppError::TooManyStreams { limit: 2 })
        ));
        assert!(matches!(
            r.push(chunk(2, 1, false, b"12")),
            Err(AppError::TooLarge { limit: 10 })
        ));
        assert_eq!(r.buffered(), 5, "only the oversize stream was dropped");
        r.clear();
        assert_eq!(r.buffered(), 0);
        let huge = Envelope::Event(Event {
            name: "x".into(),
            payload: serde_json::Value::String("a".repeat(MAX_MESSAGE_LEN)),
        });
        assert!(matches!(
            Chunker::new().encode(&huge),
            Err(AppError::TooLarge { .. })
        ));
    }
}
