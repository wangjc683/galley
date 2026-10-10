import Foundation

/// Untyped JSON, the counterpart of Rust's `serde_json::Value`: the raw
/// `p` / `r` of an envelope before it is decoded by method, and the
/// pass-through blocks the phone does not type (tool calls, runner
/// events, goals; design §6.6).
public enum JSONValue: Sendable, Hashable {
    case null
    case bool(Bool)
    /// An integer that fits `Int64`.
    case int(Int64)
    /// An integer above `Int64.max` (Rust `u64`).
    case uint(UInt64)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    /// Parse JSON text.
    public init(parsing data: Data) throws {
        self = try JSONDecoder().decode(JSONValue.self, from: data)
    }

    /// Any `Encodable` as a value (through `JSONEncoder`).
    public init<T: Encodable>(encoding value: T) throws {
        try self.init(parsing: try JSONCoding.encoder.encode(value))
    }

    /// Decode a typed value from this one (through `JSONDecoder`).
    public func decode<T: Decodable>(_ type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: jsonData())
    }

    /// Compact JSON; object keys sorted by UTF-8 bytes, as serde_json
    /// writes a `Value` without `preserve_order`.
    public func jsonData() -> Data {
        var out = ""
        JSONWriter.write(self, into: &out)
        return Data(out.utf8)
    }

    public var jsonString: String {
        String(decoding: jsonData(), as: UTF8.self)
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let object) = self { return object[key] }
        return nil
    }

    public var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    public var objectValue: [String: JSONValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    /// The integer value of `.int` / `.uint`.
    public var intValue: Int? {
        switch self {
        case .int(let i): return Int(exactly: i)
        case .uint(let u): return Int(exactly: u)
        default: return nil
        }
    }
}

extension JSONValue: Codable {
    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let i = try? c.decode(Int64.self) {
            self = .int(i)
        } else if let u = try? c.decode(UInt64.self) {
            self = .uint(u)
        } else if let d = try? c.decode(Double.self) {
            self = .double(d)
        } else if let s = try? c.decode(String.self) {
            self = .string(s)
        } else if let a = try? c.decode([JSONValue].self) {
            self = .array(a)
        } else if let o = try? c.decode([String: JSONValue].self) {
            self = .object(o)
        } else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "not a JSON value")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .int(let i): try c.encode(i)
        case .uint(let u): try c.encode(u)
        case .double(let d): try c.encode(d)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

enum JSONCoding {
    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return encoder
    }
}

/// Compact JSON text with serde_json's string escapes: `\"`, `\\`, `\b`,
/// `\f`, `\n`, `\r`, `\t`, other control characters as `\u00xx`
/// (lowercase), everything else (`/`, DEL, non-ASCII) as is.
enum JSONWriter {
    static func write(_ value: JSONValue, into out: inout String) {
        switch value {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .int(let i): out += String(i)
        case .uint(let u): out += String(u)
        case .double(let d): out += d.isFinite ? "\(d)" : "null"
        case .string(let s): writeString(s, into: &out)
        case .array(let items):
            out += "["
            for (n, item) in items.enumerated() {
                if n > 0 { out += "," }
                write(item, into: &out)
            }
            out += "]"
        case .object(let object):
            out += "{"
            let keys = object.keys.sorted { $0.utf8.lexicographicallyPrecedes($1.utf8) }
            for (n, key) in keys.enumerated() {
                if n > 0 { out += "," }
                writeString(key, into: &out)
                out += ":"
                write(object[key]!, into: &out)
            }
            out += "}"
        }
    }

    static func writeString(_ s: String, into out: inout String) {
        // Fast path for the common case (and for megabytes of base64).
        if !s.utf8.contains(where: { $0 < 0x20 || $0 == 0x22 || $0 == 0x5c }) {
            out += "\""
            out += s
            out += "\""
            return
        }
        let hex = Array("0123456789abcdef".unicodeScalars)
        var scalars = String.UnicodeScalarView()
        scalars.append("\"")
        for scalar in s.unicodeScalars {
            switch scalar.value {
            case 0x22: scalars.append(contentsOf: "\\\"".unicodeScalars)
            case 0x5c: scalars.append(contentsOf: "\\\\".unicodeScalars)
            case 0x08: scalars.append(contentsOf: "\\b".unicodeScalars)
            case 0x0c: scalars.append(contentsOf: "\\f".unicodeScalars)
            case 0x0a: scalars.append(contentsOf: "\\n".unicodeScalars)
            case 0x0d: scalars.append(contentsOf: "\\r".unicodeScalars)
            case 0x09: scalars.append(contentsOf: "\\t".unicodeScalars)
            case ..<0x20:
                scalars.append(contentsOf: "\\u00".unicodeScalars)
                scalars.append(hex[Int(scalar.value >> 4)])
                scalars.append(hex[Int(scalar.value & 0x0f)])
            default:
                scalars.append(scalar)
            }
        }
        scalars.append("\"")
        out.unicodeScalars.append(contentsOf: scalars)
    }
}
