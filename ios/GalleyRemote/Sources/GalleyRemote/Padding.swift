import Foundation

/// Plaintext padding (design §5 "不压缩，只填充"; Rust `padding`).
///
/// A padded buffer is `len u16 (big-endian) ‖ payload ‖ zero bytes`, and
/// its total size is a function of `len` alone:
/// `max(256, Padmé(2 + len))`, capped at ``maxPlaintextLength``.
/// ``unpad(_:)`` is strict: the buffer must be exactly the canonical size
/// for its declared length and every padding byte must be zero. The push
/// format uses the same layout at a fixed size (``pad(_:to:)``).
public enum Padding {
    /// Noise's message limit (Noise spec §3).
    public static let maxNoiseMessageLength = 65535
    /// ChaChaPoly tag appended to every encrypted Noise payload.
    public static let aeadTagLength = 16
    /// Largest plaintext one Noise transport message can carry.
    public static let maxPlaintextLength = maxNoiseMessageLength - aeadTagLength
    /// Floor of every padded size.
    public static let minPaddedLength = 256
    /// The `u16` length prefix.
    public static let lengthPrefix = 2
    /// Largest payload ``pad(_:)`` accepts.
    public static let maxPayloadLength = maxPlaintextLength - lengthPrefix

    /// Padmé: round `len` up so only its top `floor(log2 E) + 1` mantissa
    /// bits may be nonzero, `E = floor(log2 len)`.
    public static func padme(_ len: Int) -> Int {
        precondition(len >= 0)
        if len < 2 { return len }
        let e = Int.bitWidth - 1 - len.leadingZeroBitCount  // floor(log2 len) >= 1
        let s = UInt32.bitWidth - 1 - UInt32(e).leadingZeroBitCount + 1  // floor(log2 e) + 1
        let lastBits = e - min(s, e)
        let mask = (1 << lastBits) - 1
        return (len + mask) & ~mask
    }

    /// Canonical padded size for a payload of `payloadLength` bytes, or
    /// `nil` if it cannot fit one Noise message.
    public static func paddedLength(payloadLength: Int) -> Int? {
        guard payloadLength >= 0, payloadLength <= maxPayloadLength else { return nil }
        let needed = lengthPrefix + payloadLength
        return min(max(padme(needed), minPaddedLength), maxPlaintextLength)
    }

    /// Pad to the canonical size (``paddedLength(payloadLength:)``).
    public static func pad(_ payload: Data) throws(PaddingError) -> Data {
        guard let total = paddedLength(payloadLength: payload.count) else {
            throw .tooLarge(len: payload.count, max: maxPayloadLength)
        }
        return try pad(payload, to: total)
    }

    /// Strict inverse of ``pad(_:)``; returns the payload.
    public static func unpad(_ buffer: Data) throws(PaddingError) -> Data {
        let declared = try declaredLength(buffer)
        guard let expected = paddedLength(payloadLength: declared) else {
            throw .tooLarge(len: declared, max: maxPayloadLength)
        }
        guard buffer.count == expected else {
            throw .nonCanonicalSize(expected: expected, actual: buffer.count)
        }
        return try payloadAfterZeroCheck(buffer, declared: declared)
    }

    /// Pad to exactly `total` bytes (`total` at most `UInt16.max + 2`).
    public static func pad(_ payload: Data, to total: Int) throws(PaddingError) -> Data {
        let max = Swift.min(Swift.max(total - lengthPrefix, 0), Int(UInt16.max))
        guard payload.count <= max else { throw .tooLarge(len: payload.count, max: max) }
        var out = Data(capacity: total)
        out.appendBigEndian(UInt16(payload.count))
        out.append(payload)
        // Rust's `Vec::resize`: zero-fill, or cut when `total` < 2.
        if out.count < total {
            out.append(Data(count: total - out.count))
        } else if out.count > total {
            out = Data(out.prefix(Swift.max(total, 0)))
        }
        return out
    }

    /// Strict inverse of ``pad(_:to:)`` at a known size.
    public static func unpad(_ buffer: Data, exactly total: Int) throws(PaddingError) -> Data {
        guard buffer.count == total else {
            throw .nonCanonicalSize(expected: total, actual: buffer.count)
        }
        let declared = try declaredLength(buffer)
        return try payloadAfterZeroCheck(buffer, declared: declared)
    }

    private static func declaredLength(_ buffer: Data) throws(PaddingError) -> Int {
        guard buffer.count >= lengthPrefix else { throw .truncated }
        let start = buffer.startIndex
        let declared = Int(buffer[start]) << 8 | Int(buffer[start + 1])
        let available = buffer.count - lengthPrefix
        guard declared <= available else {
            throw .lengthOutOfRange(declared: declared, available: available)
        }
        return declared
    }

    private static func payloadAfterZeroCheck(_ buffer: Data, declared: Int) throws(PaddingError) -> Data {
        let payloadStart = buffer.startIndex + lengthPrefix
        let payloadEnd = payloadStart + declared
        guard buffer[payloadEnd..<buffer.endIndex].allSatisfy({ $0 == 0 }) else {
            throw .nonZeroPadding
        }
        return Data(buffer[payloadStart..<payloadEnd])
    }
}

/// Rust `PaddingError`, case for case.
public enum PaddingError: Error, Equatable, Sendable {
    /// Payload does not fit the target size.
    case tooLarge(len: Int, max: Int)
    /// Shorter than the length prefix.
    case truncated
    /// Declared length runs past the buffer.
    case lengthOutOfRange(declared: Int, available: Int)
    /// Buffer size is not the canonical size for the declared length.
    case nonCanonicalSize(expected: Int, actual: Int)
    case nonZeroPadding
}
