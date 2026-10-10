import Foundation

/// Chunking limits (design §6.6; Rust `app::chunk`).
public enum Chunking {
    /// Raw bytes per chunk: 48000 bytes is 64000 base64 characters, which
    /// with the envelope stays under ``NoiseSession/maxAppRecordLength``.
    public static let dataMax = 48_000
    /// Largest reassembled message, and the most bytes in flight per receiver.
    public static let maxMessageLength = 40 * 1024 * 1024
    /// Most chunked messages a receiver collects at once.
    public static let maxStreams = 4
}

/// Turns messages into `APP` record bodies, chunking the large ones. The
/// sender numbers its streams itself, from 1.
public struct Chunker: Sendable {
    private var nextID: UInt64 = 1

    public init() {}

    /// The record bodies for one message, in order: the message itself
    /// when it fits one record, otherwise its chunks.
    public mutating func encode(_ envelope: Envelope) throws(AppError) -> [Data] {
        if case .chunk = envelope { throw .badChunk("a chunk cannot be chunked") }
        let json = envelope.toJSON()
        guard json.count <= Chunking.maxMessageLength else {
            throw .tooLarge(limit: Chunking.maxMessageLength)
        }
        if json.count <= NoiseSession.maxAppRecordLength { return [json] }
        return split(json, chunkSize: Chunking.dataMax)
    }

    /// Split `json` into chunks of at most `chunkSize` bytes (clamped to
    /// 1...``Chunking/dataMax``) regardless of its size.
    public mutating func split(_ json: Data, chunkSize: Int) -> [Data] {
        let size = min(max(chunkSize, 1), Chunking.dataMax)
        let id = nextID
        nextID += 1
        let bytes = Data(json)
        let count = max((bytes.count + size - 1) / size, 1)
        return (0..<count).compactMap { index -> Data? in
            let start = index * size
            let end = min(start + size, bytes.count)
            // Like Rust's `chunks`, an empty message yields no chunk.
            guard start < end else { return nil }
            let data = Data(bytes[start..<end])
            return Envelope.chunk(Chunk(id: id, index: UInt32(index), last: index + 1 == count, data: data))
                .toJSON()
        }
    }
}

/// Collects chunks back into messages. Any error drops the stream it
/// concerns; ``clear()`` drops all (a session ended without `CLOSE`).
public struct Reassembler: Sendable {
    private struct Stream: Sendable {
        var nextIndex: UInt32
        var data: Data
    }

    private var streams: [UInt64: Stream] = [:]
    /// Bytes held in partial streams.
    public private(set) var buffered = 0
    private let maxMessageLength: Int
    private let maxStreams: Int

    public init(maxMessageLength: Int = Chunking.maxMessageLength, maxStreams: Int = Chunking.maxStreams) {
        self.maxMessageLength = maxMessageLength
        self.maxStreams = maxStreams
    }

    /// Feed one received message. A chunk is held until its stream ends,
    /// then the joined message comes back; any other message comes back
    /// at once.
    public mutating func push(_ envelope: Envelope) throws(AppError) -> Envelope? {
        guard case .chunk(let chunk) = envelope else { return envelope }
        guard !chunk.data.isEmpty, chunk.data.count <= Chunking.dataMax else {
            dropStream(chunk.id)
            throw .badChunk("chunk data size")
        }
        if let stream = streams[chunk.id] {
            guard stream.nextIndex == chunk.index else {
                dropStream(chunk.id)
                throw .badChunk("chunk out of order")
            }
        } else {
            guard chunk.index == 0 else { throw .badChunk("stream must start at 0") }
            guard streams.count < maxStreams else { throw .tooManyStreams(limit: maxStreams) }
            streams[chunk.id] = Stream(nextIndex: 0, data: Data())
        }
        guard buffered + chunk.data.count <= maxMessageLength else {
            dropStream(chunk.id)
            throw .tooLarge(limit: maxMessageLength)
        }
        streams[chunk.id]!.data.append(chunk.data)
        let (next, overflow) = streams[chunk.id]!.nextIndex.addingReportingOverflow(1)
        streams[chunk.id]!.nextIndex = overflow ? UInt32.max : next
        buffered += chunk.data.count
        guard chunk.last else { return nil }
        let stream = streams.removeValue(forKey: chunk.id)!
        buffered -= stream.data.count
        let message = try Envelope.fromJSON(stream.data)
        if case .chunk = message { throw .badChunk("a chunk inside a chunk") }
        return message
    }

    /// Drop every partial stream.
    public mutating func clear() {
        streams.removeAll()
        buffered = 0
    }

    private mutating func dropStream(_ id: UInt64) {
        if let stream = streams.removeValue(forKey: id) {
            buffered -= stream.data.count
        }
    }
}
