import Foundation

/// Lowercase hex, as the golden fixtures and APNs paths write bytes.
enum Hex {
    private static let digits = Array("0123456789abcdef".utf8)

    static func encode<D: DataProtocol>(_ bytes: D) -> String {
        var out = [UInt8]()
        out.reserveCapacity(bytes.count * 2)
        for b in bytes {
            out.append(digits[Int(b >> 4)])
            out.append(digits[Int(b & 0x0f)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// Either case; `nil` on an odd length or a non-hex character.
    static func decode(_ text: String) -> Data? {
        let chars = Array(text.utf8)
        guard chars.count % 2 == 0 else { return nil }
        var out = Data(capacity: chars.count / 2)
        var i = 0
        while i < chars.count {
            guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else { return nil }
            out.append(hi << 4 | lo)
            i += 2
        }
        return out
    }

    static func nibble(_ c: UInt8) -> UInt8? {
        switch c {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): return c - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): return c - UInt8(ascii: "a") + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): return c - UInt8(ascii: "A") + 10
        default: return nil
        }
    }
}

/// Base64 with the strictness of the Rust crate's `base64` 0.22 engines:
///
/// - `.standard`: `STANDARD`, the RFC 4648 alphabet with canonical `=`
///   padding (the push `g` field, chunk `data`).
/// - `.urlSafeNoPad`: `URL_SAFE_NO_PAD`, the URL-safe alphabet and no
///   padding at all (the QR `mk=`, the `X-Galley-Channel` header).
///
/// Decoding rejects whitespace, the other alphabet, misplaced or
/// non-canonical padding, a length of 1 mod 4, and non-zero trailing bits.
enum Base64 {
    enum Variant {
        case standard
        case urlSafeNoPad
    }

    private static let standardAlphabet = Array(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".utf8)
    private static let urlSafeAlphabet = Array(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".utf8)

    private static func alphabet(_ variant: Variant) -> [UInt8] {
        switch variant {
        case .standard: return standardAlphabet
        case .urlSafeNoPad: return urlSafeAlphabet
        }
    }

    static func encode<D: DataProtocol>(_ bytes: D, _ variant: Variant) -> String {
        let table = alphabet(variant)
        let input = Array(bytes)
        var out = [UInt8]()
        out.reserveCapacity((input.count + 2) / 3 * 4)
        var i = 0
        while i + 3 <= input.count {
            let n = UInt32(input[i]) << 16 | UInt32(input[i + 1]) << 8 | UInt32(input[i + 2])
            out.append(table[Int(n >> 18 & 63)])
            out.append(table[Int(n >> 12 & 63)])
            out.append(table[Int(n >> 6 & 63)])
            out.append(table[Int(n & 63)])
            i += 3
        }
        let rest = input.count - i
        if rest == 1 {
            let n = UInt32(input[i]) << 16
            out.append(table[Int(n >> 18 & 63)])
            out.append(table[Int(n >> 12 & 63)])
            if variant == .standard { out.append(contentsOf: Array("==".utf8)) }
        } else if rest == 2 {
            let n = UInt32(input[i]) << 16 | UInt32(input[i + 1]) << 8
            out.append(table[Int(n >> 18 & 63)])
            out.append(table[Int(n >> 12 & 63)])
            out.append(table[Int(n >> 6 & 63)])
            if variant == .standard { out.append(UInt8(ascii: "=")) }
        }
        return String(decoding: out, as: UTF8.self)
    }

    static func decode(_ text: String, _ variant: Variant) -> Data? {
        var chars = Array(text.utf8)
        let pad = UInt8(ascii: "=")
        switch variant {
        case .standard:
            // Canonical padding: always a multiple of 4, `=` only at the end
            // and exactly as many as the last group needs.
            guard chars.count % 4 == 0 else { return nil }
            var pads = 0
            while pads < 2, let last = chars.last, last == pad {
                chars.removeLast()
                pads += 1
            }
            let remainder = chars.count % 4
            guard (pads == 0 && remainder == 0) || (pads == 1 && remainder == 3)
                || (pads == 2 && remainder == 2)
            else { return nil }
        case .urlSafeNoPad:
            guard chars.count % 4 != 1 else { return nil }
        }
        let table = alphabet(variant)
        var lookup = [Int8](repeating: -1, count: 256)
        for (value, c) in table.enumerated() { lookup[Int(c)] = Int8(value) }

        var values = [UInt8]()
        values.reserveCapacity(chars.count)
        for c in chars {
            let v = lookup[Int(c)]
            guard v >= 0 else { return nil }  // also any `=` left over
            values.append(UInt8(v))
        }
        var out = Data(capacity: values.count / 4 * 3 + 2)
        var i = 0
        while i + 4 <= values.count {
            let n = UInt32(values[i]) << 18 | UInt32(values[i + 1]) << 12
                | UInt32(values[i + 2]) << 6 | UInt32(values[i + 3])
            out.append(UInt8(n >> 16 & 0xff))
            out.append(UInt8(n >> 8 & 0xff))
            out.append(UInt8(n & 0xff))
            i += 4
        }
        switch values.count - i {
        case 0:
            break
        case 2:
            guard values[i + 1] & 0x0f == 0 else { return nil }  // trailing bits
            out.append(values[i] << 2 | values[i + 1] >> 4)
        case 3:
            guard values[i + 2] & 0x03 == 0 else { return nil }  // trailing bits
            out.append(values[i] << 2 | values[i + 1] >> 4)
            out.append(values[i + 1] << 4 | values[i + 2] >> 2)
        default:
            return nil
        }
        return out
    }
}

/// Reads one big-endian layout front to back; `Data` slices keep their
/// parent's indices, so everything goes through `offset`.
struct ByteReader {
    let bytes: Data
    private(set) var offset: Data.Index

    init(_ bytes: Data) {
        self.bytes = bytes
        self.offset = bytes.startIndex
    }

    var remaining: Int { bytes.endIndex - offset }

    mutating func take(_ count: Int) -> Data? {
        guard count >= 0, remaining >= count else { return nil }
        let out = Data(bytes[offset..<offset + count])
        offset += count
        return out
    }

    mutating func u8() -> UInt8? {
        guard remaining >= 1 else { return nil }
        defer { offset += 1 }
        return bytes[offset]
    }

    mutating func u16() -> UInt16? {
        guard let b = take(2) else { return nil }
        return b.reduce(0) { $0 << 8 | UInt16($1) }
    }

    mutating func u32() -> UInt32? {
        guard let b = take(4) else { return nil }
        return b.reduce(0) { $0 << 8 | UInt32($1) }
    }

    mutating func u64() -> UInt64? {
        guard let b = take(8) else { return nil }
        return b.reduce(0) { $0 << 8 | UInt64($1) }
    }

    mutating func rest() -> Data {
        let out = Data(bytes[offset..<bytes.endIndex])
        offset = bytes.endIndex
        return out
    }
}

extension Data {
    mutating func appendBigEndian<T: FixedWidthInteger>(_ value: T) {
        Swift.withUnsafeBytes(of: value.bigEndian) { append(contentsOf: $0) }
    }
}

/// Rust's `u8::is_ascii_graphic`: `!` through `~`.
@inline(__always)
func isASCIIGraphic(_ b: UInt8) -> Bool {
    b >= 0x21 && b <= 0x7e
}
