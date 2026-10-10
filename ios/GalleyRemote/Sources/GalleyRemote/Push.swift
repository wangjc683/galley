import CryptoKit
import Foundation

/// Push content (design §4.3; Rust `push`): what the desktop puts in a
/// push, sealed with ``PushKey`` so the relay and APNs see only
/// ciphertext; the Notification Service Extension opens it.
///
/// - Plaintext: ``PushContent`` as JSON, padded (``Padding/pad(_:to:)``) to
///   exactly ``paddedLength`` bytes.
/// - Sealed: `nonce (12 random bytes) ‖ ChaCha20-Poly1305(push_key, nonce,
///   plaintext, aad = "galley-push/1")`, always ``sealedLength`` bytes.
/// - The APNs field `g` is the sealed bytes in standard base64 with padding.
///
/// `seq` is carried, not checked: the extension keeps the highest `seq` it
/// has shown and drops anything not above it (relay replay).
public enum Push {
    /// AEAD associated data: the push format version.
    public static let aad = Data("galley-push/1".utf8)
    public static let nonceLength = 12
    public static let tagLength = 16
    /// Padded plaintext size of every push.
    public static let paddedLength = 2048
    /// `nonce ‖ ciphertext ‖ tag`.
    public static let sealedLength = nonceLength + paddedLength + tagLength
    /// APNs payload limit for alert pushes.
    public static let apnsMaxPayloadLength = 4096
    /// `title` budget, in bytes after JSON escaping.
    public static let titleMaxJSONBytes = 256
    /// `body` budget, in bytes after JSON escaping.
    public static let bodyMaxJSONBytes = 1536
    /// Longest `sessionId` (printable ASCII without `"` and `\`).
    public static let sessionIDMaxBytes = 128
    /// Longest `kind` (`[a-z0-9_]`).
    public static let kindMaxBytes = 32
    /// What the lock screen shows if the extension cannot open the push.
    public static let placeholderTitle = "Galley"
    public static let placeholderBody = "有新消息"

    /// Known `kind` values (PRD ruling 17). Open set: show unknown kinds
    /// like any other push.
    public enum Kind {
        public static let replyDone = "reply_done"
        public static let askUser = "ask_user"
        public static let goal = "goal"
        public static let scheduleFailed = "schedule_failed"
    }

    /// Seal `content` with a fresh random nonce: `nonce ‖ ciphertext`.
    /// The phone only opens pushes; this is here for tests and parity.
    public static func seal(key: PushKey, content: PushContent) throws(PushError) -> Data {
        try seal(key: key, content: content, nonce: ChaChaPoly.Nonce())
    }

    /// ``seal(key:content:)`` with a caller-chosen nonce, for the golden
    /// fixture only: reusing a nonce under one key breaks ChaCha20-Poly1305.
    static func sealWithNonceForTestingOnly(
        key: PushKey, content: PushContent, nonce: Data
    ) throws(PushError) -> Data {
        guard let nonce = try? ChaChaPoly.Nonce(data: nonce) else {
            throw .badLength(expected: nonceLength, actual: nonce.count)
        }
        return try seal(key: key, content: content, nonce: nonce)
    }

    private static func seal(key: PushKey, content: PushContent, nonce: ChaChaPoly.Nonce) throws(PushError) -> Data {
        let plaintext = try content.paddedPlaintext()
        do {
            let box = try ChaChaPoly.seal(
                plaintext, using: key.symmetricKey, nonce: nonce, authenticating: aad)
            return box.combined
        } catch {
            throw .tooLarge
        }
    }

    /// Open a sealed push: exact length, tag, padding, JSON (unknown
    /// fields ignored).
    public static func open(key: PushKey, sealed: Data) throws(PushError) -> PushContent {
        guard sealed.count == sealedLength else {
            throw .badLength(expected: sealedLength, actual: sealed.count)
        }
        let plaintext: Data
        do {
            let box = try ChaChaPoly.SealedBox(combined: sealed)
            plaintext = try ChaChaPoly.open(box, using: key.symmetricKey, authenticating: aad)
        } catch {
            throw .decrypt
        }
        let json: Data
        do {
            json = try Padding.unpad(plaintext, exactly: paddedLength)
        } catch {
            throw .padding(error)
        }
        do {
            return try JSONDecoder().decode(PushContent.self, from: json)
        } catch {
            throw .json(String(describing: error))
        }
    }

    /// The APNs `g` value: standard base64 with padding.
    public static func encodeG(_ sealed: Data) -> String {
        Base64.encode(sealed, .standard)
    }

    /// Strict inverse of ``encodeG(_:)``, then ``open(key:sealed:)``.
    public static func openG(key: PushKey, g: String) throws(PushError) -> PushContent {
        guard let sealed = Base64.decode(g, .standard) else { throw .badBase64 }
        return try open(key: key, sealed: sealed)
    }

    /// The full APNs JSON payload for a sealed push: the placeholder
    /// alert, `mutable-content: 1` so the extension runs, and `g`.
    public static func apnsPayload(sealed: Data) throws(PushError) -> String {
        let payload =
            #"{"aps":{"alert":{"title":""# + placeholderTitle + #"","body":""# + placeholderBody
            + #""},"mutable-content":1,"sound":"default"},"g":""# + encodeG(sealed) + #""}"#
        guard payload.utf8.count <= apnsMaxPayloadLength else { throw .tooLarge }
        return payload
    }

    /// Bytes `scalar` takes once serde_json has escaped it inside a string.
    static func jsonEscapedLength(_ scalar: Unicode.Scalar) -> Int {
        switch scalar.value {
        case 0x22, 0x5c, 0x08, 0x0c, 0x0a, 0x0d, 0x09: return 2
        case ..<0x20: return 6
        default: return UTF8.width(scalar)
        }
    }

    /// Bytes `s` takes inside a JSON string.
    public static func jsonEscapedLength(of s: String) -> Int {
        s.unicodeScalars.reduce(0) { $0 + jsonEscapedLength($1) }
    }

    /// Cut `s` so its JSON-escaped form is at most `max` bytes, on a
    /// Unicode scalar boundary (Rust `char`), ending in `…` when cut.
    public static func truncateForJSON(_ s: String, max: Int) -> String {
        if jsonEscapedLength(of: s) <= max { return s }
        let ellipsis: Unicode.Scalar = "…"
        let budget = Swift.max(max - UTF8.width(ellipsis), 0)
        var used = 0
        var out = String.UnicodeScalarView()
        for scalar in s.unicodeScalars {
            let length = jsonEscapedLength(scalar)
            if used + length > budget { break }
            used += length
            out.append(scalar)
        }
        if max >= UTF8.width(ellipsis) { out.append(ellipsis) }
        return String(out)
    }
}

/// The push plaintext: `{seq, sessionId, kind, title, body}`.
public struct PushContent: Codable, Sendable, Hashable {
    /// Monotonic per desktop.
    public var seq: UInt64
    /// Session the tap opens; `null` when there is none.
    public var sessionId: String?
    /// One of ``Push/Kind``.
    public var kind: String
    public var title: String
    public var body: String

    /// Build a push the way Core does (Rust `PushContent::new`): checks
    /// `sessionId` and `kind`, cuts `title` and `body` to their budgets.
    public init(seq: UInt64, sessionId: String?, kind: String, title: String, body: String) throws(PushError) {
        if let id = sessionId {
            let bytes = Array(id.utf8)
            guard !bytes.isEmpty, bytes.count <= Push.sessionIDMaxBytes,
                bytes.allSatisfy({ isASCIIGraphic($0) && $0 != 0x22 && $0 != 0x5c })
            else { throw .badField("sessionId") }
        }
        let kindBytes = Array(kind.utf8)
        guard !kindBytes.isEmpty, kindBytes.count <= Push.kindMaxBytes,
            kindBytes.allSatisfy({
                ($0 >= UInt8(ascii: "a") && $0 <= UInt8(ascii: "z"))
                    || ($0 >= UInt8(ascii: "0") && $0 <= UInt8(ascii: "9")) || $0 == UInt8(ascii: "_")
            })
        else { throw .badField("kind") }
        self.init(
            unchecked: seq, sessionId: sessionId, kind: kind,
            title: Push.truncateForJSON(title, max: Push.titleMaxJSONBytes),
            body: Push.truncateForJSON(body, max: Push.bodyMaxJSONBytes))
    }

    /// Memberwise, without the checks (tests build oversized content).
    init(unchecked seq: UInt64, sessionId: String?, kind: String, title: String, body: String) {
        self.seq = seq
        self.sessionId = sessionId
        self.kind = kind
        self.title = title
        self.body = body
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(seq, forKey: .seq)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(kind, forKey: .kind)
        try c.encode(title, forKey: .title)
        try c.encode(body, forKey: .body)
    }

    /// The JSON exactly as Rust's serde_json writes it: fields in
    /// declaration order, compact, the same string escapes.
    public func jsonBytes() -> Data {
        var out = "{\"seq\":\(seq),\"sessionId\":"
        if let sessionId {
            JSONWriter.writeString(sessionId, into: &out)
        } else {
            out += "null"
        }
        out += ",\"kind\":"
        JSONWriter.writeString(kind, into: &out)
        out += ",\"title\":"
        JSONWriter.writeString(title, into: &out)
        out += ",\"body\":"
        JSONWriter.writeString(body, into: &out)
        out += "}"
        return Data(out.utf8)
    }

    /// The JSON padded to ``Push/paddedLength``.
    public func paddedPlaintext() throws(PushError) -> Data {
        do {
            return try Padding.pad(jsonBytes(), to: Push.paddedLength)
        } catch {
            throw .tooLarge
        }
    }
}

/// Rust `PushError`, case for case.
public enum PushError: Error, Equatable, Sendable {
    /// `sessionId` or `kind` breaks its rules.
    case badField(String)
    /// The content does not fit ``Push/paddedLength``.
    case tooLarge
    /// The system random source failed.
    case random
    /// Wrong length for a sealed push.
    case badLength(expected: Int, actual: Int)
    /// Not standard base64.
    case badBase64
    /// Wrong key, tampered, or another format version.
    case decrypt
    case padding(PaddingError)
    case json(String)
}
