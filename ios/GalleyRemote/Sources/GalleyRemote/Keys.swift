import CryptoKit
import Foundation

/// Pairing keys (design §3.1; Rust `keys`).
///
/// The desktop generates one 32-byte pairing master key (MK) and shows it
/// once, in the pairing QR code. Both ends derive three single-purpose
/// keys from it with HKDF-SHA256 (RFC 5869; salt `galley-remote-v1`, one
/// `info` label per purpose):
///
/// | Key | `info` | Who sees it |
/// |---|---|---|
/// | ``ChannelSecret`` | `channel` | the relay (it routes by `SHA-256(channel_secret)`) |
/// | ``NoisePSK`` | `noise-psk` | the two ends |
/// | ``PushKey`` | `push` | the two ends and the Notification Service Extension |
///
/// Key types print `<redacted>` and reflect no children, so a key cannot
/// reach a log line through `print`, `dump` or string interpolation.
public enum PairingKeys {
    /// Every key here is 32 bytes.
    public static let keyLength = 32
    /// HKDF-SHA256 salt for every derivation from the master key.
    public static let hkdfSalt = Data("galley-remote-v1".utf8)
    /// HKDF `info` of ``ChannelSecret``.
    public static let infoChannel = Data("channel".utf8)
    /// HKDF `info` of ``NoisePSK``.
    public static let infoNoisePSK = Data("noise-psk".utf8)
    /// HKDF `info` of ``PushKey``.
    public static let infoPush = Data("push".utf8)
}

/// Why key material could not be produced or read (Rust `KeyError`).
public enum KeyError: Error, Equatable, Sendable {
    /// The OS random source failed.
    case random
    /// Not base64url without padding (or non-canonical trailing bits).
    case badBase64
    /// Decoded to the wrong number of bytes.
    case badLength(expected: Int, actual: Int)
}

/// A 32-byte secret that never prints itself.
public protocol RedactedKey: Sendable, CustomStringConvertible, CustomDebugStringConvertible,
    CustomReflectable
{
    var symmetricKey: SymmetricKey { get }
}

extension RedactedKey {
    public var description: String { "\(Self.self)(<redacted>)" }
    public var debugDescription: String { description }
    public var customMirror: Mirror { Mirror(self, children: [], displayStyle: .struct) }

    /// The raw key bytes, e.g. to store the master key in the keychain.
    /// Keep them out of logs and error text.
    public func exposeSecret() -> Data {
        symmetricKey.withUnsafeBytes { Data($0) }
    }
}

private func key32(_ bytes: Data) throws(KeyError) -> SymmetricKey {
    guard bytes.count == PairingKeys.keyLength else {
        throw .badLength(expected: PairingKeys.keyLength, actual: bytes.count)
    }
    return SymmetricKey(data: bytes)
}

/// Decode unpadded base64url into exactly 32 bytes.
private func decodeKey(_ value: String) throws(KeyError) -> SymmetricKey {
    guard let bytes = Base64.decode(value, .urlSafeNoPad) else { throw .badBase64 }
    return try key32(bytes)
}

/// The pairing master key (MK): 32 random bytes from the desktop, kept in
/// the phone's keychain. Everything else is derived from it.
public struct MasterKey: RedactedKey {
    public let symmetricKey: SymmetricKey

    /// Wrap raw key bytes (e.g. read back from the keychain).
    public init(bytes: Data) throws(KeyError) {
        symmetricKey = try key32(bytes)
    }

    /// 32 fresh bytes from the system random source.
    public static func generate() -> MasterKey {
        MasterKey(SymmetricKey(size: .bits256))
    }

    private init(_ key: SymmetricKey) { symmetricKey = key }

    /// HKDF-SHA256 with ``PairingKeys/hkdfSalt``; one expand per purpose.
    public func derive() -> DerivedKeys {
        func expand(_ info: Data) -> SymmetricKey {
            HKDF<SHA256>.deriveKey(
                inputKeyMaterial: symmetricKey, salt: PairingKeys.hkdfSalt, info: info,
                outputByteCount: PairingKeys.keyLength)
        }
        return DerivedKeys(
            channelSecret: ChannelSecret(symmetricKey: expand(PairingKeys.infoChannel)),
            noisePSK: NoisePSK(symmetricKey: expand(PairingKeys.infoNoisePSK)),
            pushKey: PushKey(symmetricKey: expand(PairingKeys.infoPush)))
    }

    /// Unpadded base64url, as the QR string's `mk=` carries it.
    public var base64url: String { Base64.encode(exposeSecret(), .urlSafeNoPad) }

    /// Strict inverse of ``base64url``: exactly 32 bytes.
    public init(base64url: String) throws(KeyError) {
        symmetricKey = try decodeKey(base64url)
    }
}

/// The three keys derived from one ``MasterKey``.
public struct DerivedKeys: Sendable, CustomStringConvertible {
    public let channelSecret: ChannelSecret
    public let noisePSK: NoisePSK
    public let pushKey: PushKey

    public var description: String {
        "DerivedKeys(channelSecret: \(channelSecret), noisePSK: \(noisePSK), pushKey: \(pushKey))"
    }
}

/// Shown to the relay on connect (`X-Galley-Channel`). Knowing it lets a
/// peer join the channel, not read or forge any traffic.
public struct ChannelSecret: RedactedKey {
    public let symmetricKey: SymmetricKey

    public init(bytes: Data) throws(KeyError) { symmetricKey = try key32(bytes) }
    init(symmetricKey: SymmetricKey) { self.symmetricKey = symmetricKey }

    /// The relay's channel table key: `SHA-256(channel_secret)`.
    public var channelKey: ChannelKey {
        ChannelKey(bytes: Data(SHA256.hash(data: exposeSecret())))
    }

    /// Value of the `X-Galley-Channel` connect header: unpadded base64url.
    public var headerValue: String { Base64.encode(exposeSecret(), .urlSafeNoPad) }

    /// Strict inverse of ``headerValue`` (the relay's side): exactly 32 bytes.
    public init(headerValue: String) throws(KeyError) {
        symmetricKey = try decodeKey(headerValue)
    }
}

/// The `psk` of the `NNpsk0` handshake (``ClientHandshake``).
public struct NoisePSK: RedactedKey {
    public let symmetricKey: SymmetricKey
    public init(bytes: Data) throws(KeyError) { symmetricKey = try key32(bytes) }
    init(symmetricKey: SymmetricKey) { self.symmetricKey = symmetricKey }
}

/// The ChaCha20-Poly1305 key of push content (``Push``).
public struct PushKey: RedactedKey {
    public let symmetricKey: SymmetricKey
    public init(bytes: Data) throws(KeyError) { symmetricKey = try key32(bytes) }
    init(symmetricKey: SymmetricKey) { self.symmetricKey = symmetricKey }
}

/// `SHA-256(channel_secret)`: the relay's routing key for one pairing.
/// Not a secret, but it identifies a user's channel, so it prints redacted.
public struct ChannelKey: Sendable, Hashable, CustomStringConvertible, CustomDebugStringConvertible {
    public let bytes: Data
    public var description: String { "ChannelKey(<redacted>)" }
    public var debugDescription: String { description }
}

// MARK: - Relay URL

/// Why a relay URL was rejected (Rust `RelayUrlError`).
public enum RelayURLError: Error, Equatable, Sendable {
    case tooLong
    /// Neither `wss://` nor `ws://`.
    case badScheme
    /// `ws://` to a host that is not loopback.
    case insecureRemote
    /// Whitespace, control or non-ASCII characters, or a userinfo / query
    /// / fragment part.
    case badCharacter
    case badHost
    case badPort
    case badPath
}

/// A relay base URL: `wss://host[:port][/path]`, or `ws://` to a loopback
/// host (`localhost`, `127.0.0.0/8`, `[::1]`) for a dev relay. No userinfo,
/// query or fragment. Normalized: lowercase host, no trailing `/`.
public struct RelayURL: Sendable, Hashable, CustomStringConvertible {
    /// The normalized URL.
    public let url: String
    /// Host as written in the URL (lowercase; IPv6 keeps its brackets).
    public let host: String
    /// `true` for `wss://`.
    public let isSecure: Bool

    /// Longest relay URL, before percent-encoding.
    public static let maxLength = 512

    public var description: String { url }

    /// The WebSocket URL to connect to: this URL plus
    /// ``RelayProtocol/connectPath``.
    public var connectURL: String { url + RelayProtocol.connectPath }

    public static func parse(_ input: String) throws(RelayURLError) -> RelayURL {
        let bytes = Array(input.utf8)
        guard bytes.count <= maxLength else { throw .tooLong }
        let secure: Bool
        let rest: ArraySlice<UInt8>
        if bytes.starts(with: Array("wss://".utf8)) {
            secure = true
            rest = bytes.dropFirst(6)
        } else if bytes.starts(with: Array("ws://".utf8)) {
            secure = false
            rest = bytes.dropFirst(5)
        } else {
            throw .badScheme
        }
        let forbidden: Set<UInt8> = [UInt8(ascii: "@"), UInt8(ascii: "?"), UInt8(ascii: "#")]
        guard rest.allSatisfy({ isASCIIGraphic($0) && !forbidden.contains($0) }) else {
            throw .badCharacter
        }
        // All ASCII from here on, so byte slices are valid strings.
        let slash = rest.firstIndex(of: UInt8(ascii: "/"))
        let authority = Array(rest[rest.startIndex..<(slash ?? rest.endIndex)])
        let path = Array(rest[(slash ?? rest.endIndex)...])
        let (rawHost, port) = try splitHostPort(authority)
        let host = String(decoding: rawHost, as: UTF8.self).lowercased()
        let normalizedPath = try normalizePath(path)
        if !secure && !isLoopbackHost(host) { throw .insecureRemote }
        let scheme = secure ? "wss" : "ws"
        let url =
            if let port { "\(scheme)://\(host):\(port)\(normalizedPath)" } else {
                "\(scheme)://\(host)\(normalizedPath)"
            }
        return RelayURL(url: url, host: host, isSecure: secure)
    }

    private static func splitHostPort(_ authority: [UInt8]) throws(RelayURLError) -> ([UInt8], UInt16?) {
        let host: [UInt8]
        let portText: [UInt8]?
        if authority.first == UInt8(ascii: "[") {
            guard let end = authority.firstIndex(of: UInt8(ascii: "]")) else { throw .badHost }
            guard IPAddress.parseIPv6(Array(authority[1..<end])) != nil else { throw .badHost }
            let after = authority[(end + 1)...]
            if after.isEmpty {
                portText = nil
            } else {
                guard after.first == UInt8(ascii: ":") else { throw .badPort }
                portText = Array(after.dropFirst())
            }
            host = Array(authority[...end])
        } else {
            if let colon = authority.firstIndex(of: UInt8(ascii: ":")) {
                host = Array(authority[..<colon])
                portText = Array(authority[(colon + 1)...])
            } else {
                host = authority
                portText = nil
            }
            guard isRegName(host) else { throw .badHost }
        }
        guard let portText else { return (host, nil) }
        guard !portText.isEmpty, portText.count <= 5,
            portText.allSatisfy({ $0 >= UInt8(ascii: "0") && $0 <= UInt8(ascii: "9") })
        else { throw .badPort }
        let value = portText.reduce(0) { $0 * 10 + Int($1 - UInt8(ascii: "0")) }
        guard value != 0, value <= Int(UInt16.max) else { throw .badPort }
        return (host, UInt16(value))
    }

    /// DNS name or dotted IPv4: dot-separated labels of ASCII letters,
    /// digits and inner hyphens.
    private static func isRegName(_ host: [UInt8]) -> Bool {
        guard !host.isEmpty, host.count <= 253 else { return false }
        let hyphen = UInt8(ascii: "-")
        return host.split(separator: UInt8(ascii: "."), omittingEmptySubsequences: false)
            .allSatisfy { label in
                !label.isEmpty && label.count <= 63 && label.first != hyphen
                    && label.last != hyphen
                    && label.allSatisfy { isASCIIAlphanumeric($0) || $0 == hyphen }
            }
    }

    private static func isLoopbackHost(_ host: String) -> Bool {
        if host == "localhost" { return true }
        let bytes = Array(host.utf8)
        if bytes.first == UInt8(ascii: "["), bytes.last == UInt8(ascii: "]"), bytes.count >= 2 {
            guard let ip = IPAddress.parseIPv6(Array(bytes[1..<(bytes.count - 1)])) else {
                return false
            }
            return ip == [0, 0, 0, 0, 0, 0, 0, 1]
        }
        guard let ip = IPAddress.parseIPv4(bytes) else { return false }
        return ip[0] == 127
    }

    /// Optional base path: `/`-separated segments of unreserved
    /// characters, no `.` / `..` / empty segments; trailing slashes dropped.
    private static func normalizePath(_ path: [UInt8]) throws(RelayURLError) -> String {
        var trimmed = path
        while trimmed.last == UInt8(ascii: "/") { trimmed.removeLast() }
        if trimmed.isEmpty { return "" }
        for segment in trimmed.dropFirst().split(
            separator: UInt8(ascii: "/"), omittingEmptySubsequences: false)
        {
            let text = String(decoding: segment, as: UTF8.self)
            guard !segment.isEmpty, text != ".", text != "..",
                segment.allSatisfy(isUnreserved)
            else { throw .badPath }
        }
        return String(decoding: trimmed, as: UTF8.self)
    }
}

@inline(__always)
private func isASCIIAlphanumeric(_ b: UInt8) -> Bool {
    (b >= UInt8(ascii: "0") && b <= UInt8(ascii: "9"))
        || (b >= UInt8(ascii: "a") && b <= UInt8(ascii: "z"))
        || (b >= UInt8(ascii: "A") && b <= UInt8(ascii: "Z"))
}

/// RFC 3986 unreserved: the only bytes `percentEncode` leaves as they are.
@inline(__always)
private func isUnreserved(_ b: UInt8) -> Bool {
    isASCIIAlphanumeric(b) || b == UInt8(ascii: "-") || b == UInt8(ascii: ".")
        || b == UInt8(ascii: "_") || b == UInt8(ascii: "~")
}

private func ipDigit(_ c: UInt8, radix: Int) -> Int? {
    guard let n = Hex.nibble(c), Int(n) < radix else { return nil }
    return Int(n)
}

/// IP literal parsers with the exact accept set of Rust's
/// `Ipv4Addr::from_str` / `Ipv6Addr::from_str` (`core::net::parser`), so a
/// relay URL is accepted or refused on both ends alike.
enum IPAddress {
    /// Four decimal octets, no leading zeros, nothing else.
    static func parseIPv4(_ text: [UInt8]) -> [UInt8]? {
        var p = Parser(text)
        guard let octets = p.ipv4(), p.atEnd else { return nil }
        return octets
    }

    /// Eight 16-bit groups, with `::` and a trailing embedded IPv4.
    static func parseIPv6(_ text: [UInt8]) -> [UInt16]? {
        var p = Parser(text)
        guard let groups = p.ipv6(), p.atEnd else { return nil }
        return groups
    }

    private struct Parser {
        let s: [UInt8]
        var i = 0
        init(_ s: [UInt8]) { self.s = s }

        var atEnd: Bool { i == s.count }

        /// Runs `body`; rewinds when it fails (Rust `read_atomically`).
        mutating func atomically<T>(_ body: (inout Parser) -> T?) -> T? {
            let saved = i
            let out = body(&self)
            if out == nil { i = saved }
            return out
        }

        mutating func char(_ c: UInt8) -> Bool {
            atomically { p -> Bool? in
                guard p.i < p.s.count, p.s[p.i] == c else { return nil }
                p.i += 1
                return true
            } ?? false
        }

        /// Rust `read_number(radix, max_digits, allow_zero_prefix)`.
        mutating func number(radix: Int, maxDigits: Int, allowZeroPrefix: Bool, limit: Int) -> Int? {
            atomically { p -> Int? in
                var result = 0
                var digits = 0
                let leadingZero = p.i < p.s.count && p.s[p.i] == UInt8(ascii: "0")
                while p.i < p.s.count, let d = ipDigit(p.s[p.i], radix: radix) {
                    p.i += 1
                    result = result * radix + d
                    if result > limit { return nil }
                    digits += 1
                    if digits > maxDigits { return nil }
                }
                if digits == 0 { return nil }
                if !allowZeroPrefix && leadingZero && digits > 1 { return nil }
                return result
            }
        }

        /// `index > 0` needs the separator first (Rust `read_separator`).
        mutating func separated<T>(_ sep: UInt8, _ index: Int, _ body: (inout Parser) -> T?) -> T? {
            atomically { p -> T? in
                if index > 0 && !p.char(sep) { return nil }
                return body(&p)
            }
        }

        mutating func ipv4() -> [UInt8]? {
            atomically { p -> [UInt8]? in
                var octets = [UInt8]()
                for index in 0..<4 {
                    guard
                        let n = p.separated(UInt8(ascii: "."), index, { q in
                            q.number(radix: 10, maxDigits: 3, allowZeroPrefix: false, limit: 255)
                        })
                    else { return nil }
                    octets.append(UInt8(n))
                }
                return octets
            }
        }

        /// Rust `read_groups`: groups read, and whether an IPv4 tail ended it.
        mutating func groups(into groups: inout [UInt16], limit: Int) -> (Int, Bool) {
            for index in 0..<limit {
                if index < limit - 1,
                    let v4 = separated(UInt8(ascii: ":"), index, { $0.ipv4() })
                {
                    groups[index] = UInt16(v4[0]) << 8 | UInt16(v4[1])
                    groups[index + 1] = UInt16(v4[2]) << 8 | UInt16(v4[3])
                    return (index + 2, true)
                }
                guard
                    let group = separated(UInt8(ascii: ":"), index, { q in
                        q.number(radix: 16, maxDigits: 4, allowZeroPrefix: true, limit: 0xffff)
                    })
                else { return (index, false) }
                groups[index] = UInt16(group)
            }
            return (limit, false)
        }

        mutating func ipv6() -> [UInt16]? {
            atomically { p -> [UInt16]? in
                var head = [UInt16](repeating: 0, count: 8)
                let (headSize, headIPv4) = p.groups(into: &head, limit: 8)
                if headSize == 8 { return head }
                if headIPv4 { return nil }
                guard p.char(UInt8(ascii: ":")), p.char(UInt8(ascii: ":")) else { return nil }
                var tail = [UInt16](repeating: 0, count: 7)
                let (tailSize, _) = p.groups(into: &tail, limit: 8 - (headSize + 1))
                for k in 0..<tailSize { head[8 - tailSize + k] = tail[k] }
                return head
            }
        }
    }
}

// MARK: - Pairing QR

/// Why a QR string or one of its fields was rejected (Rust `QrError`). No
/// case carries key material.
public enum QRError: Error, Equatable, Sendable {
    /// Not `galley-pair:1?…` (other scheme or version).
    case badPrefix
    case tooLong
    /// A `key=value` pair without `=`, or an empty query.
    case malformedQuery
    case unknownKey(String)
    case duplicateKey(String)
    case missingKey(String)
    /// A `%` not followed by two hex digits, or a raw character that must
    /// be percent-encoded (space, control, non-ASCII, `&`, `=`, `#`, `+`).
    case badPercentEncoding
    case badUTF8
    case badMasterKey(KeyError)
    case badRelayURL(RelayURLError)
    /// Empty, blank, longer than 128 bytes, or with control characters.
    case badDesktopName
}

/// What the pairing QR code carries:
/// `galley-pair:1?relay=<url>&mk=<base64url(MK)>&name=<desktop name>`.
///
/// `relay` and `name` are percent-encoded (everything but RFC 3986
/// unreserved characters); `mk` is unpadded base64url. ``parse(_:)`` is
/// strict: exact scheme and version, each of the three fields exactly once
/// (any order), no other field, `mk` decoding to exactly 32 bytes, `relay`
/// a valid ``RelayURL``.
public struct PairingCode: Sendable {
    public let relay: RelayURL
    public let masterKey: MasterKey
    public let desktopName: String

    /// Scheme and version of the pairing QR string.
    public static let prefix = "galley-pair:1?"
    /// Longest QR string ``parse(_:)`` looks at.
    public static let maxLength = 2048
    /// Longest desktop display name, in UTF-8 bytes.
    public static let desktopNameMaxBytes = 128

    public init(relay: RelayURL, masterKey: MasterKey, desktopName: String) throws(QRError) {
        try PairingCode.validateDesktopName(desktopName)
        self.relay = relay
        self.masterKey = masterKey
        self.desktopName = desktopName
    }

    /// The QR string. It holds the master key: show it on screen only.
    public var qrString: String {
        PairingCode.prefix + "relay=" + PairingCode.percentEncode(relay.url) + "&mk="
            + masterKey.base64url + "&name=" + PairingCode.percentEncode(desktopName)
    }

    public static func parse(_ input: String) throws(QRError) -> PairingCode {
        let bytes = Array(input.utf8)
        guard bytes.count <= maxLength else { throw .tooLong }
        let prefixBytes = Array(prefix.utf8)
        guard bytes.starts(with: prefixBytes) else { throw .badPrefix }
        let query = bytes[prefixBytes.count...]
        var relay: ArraySlice<UInt8>?
        var mk: ArraySlice<UInt8>?
        var name: ArraySlice<UInt8>?
        for pair in query.split(separator: UInt8(ascii: "&"), omittingEmptySubsequences: false) {
            guard let eq = pair.firstIndex(of: UInt8(ascii: "=")) else { throw .malformedQuery }
            let key = String(decoding: pair[pair.startIndex..<eq], as: UTF8.self)
            let value = pair[(eq + 1)...]
            switch key {
            case "relay":
                guard relay == nil else { throw .duplicateKey("relay") }
                relay = value
            case "mk":
                guard mk == nil else { throw .duplicateKey("mk") }
                mk = value
            case "name":
                guard name == nil else { throw .duplicateKey("name") }
                name = value
            default:
                // Rust carries the key as `String`; the input was UTF-8.
                throw .unknownKey(key)
            }
        }
        guard let relay else { throw .missingKey("relay") }
        guard let mk else { throw .missingKey("mk") }
        guard let name else { throw .missingKey("name") }

        let relayText = try percentDecode(relay)
        let relayURL: RelayURL
        do {
            relayURL = try RelayURL.parse(relayText)
        } catch {
            throw .badRelayURL(error)
        }
        let masterKey: MasterKey
        do {
            masterKey = try MasterKey(base64url: String(decoding: mk, as: UTF8.self))
        } catch {
            throw .badMasterKey(error)
        }
        let desktopName = try percentDecode(name)
        return try PairingCode(relay: relayURL, masterKey: masterKey, desktopName: desktopName)
    }

    static func validateDesktopName(_ name: String) throws(QRError) {
        let blank = name.unicodeScalars.allSatisfy { $0.properties.isWhitespace }
        let control = name.unicodeScalars.contains { $0.properties.generalCategory == .control }
        guard !blank, name.utf8.count <= desktopNameMaxBytes, !control else {
            throw .badDesktopName
        }
    }

    static func percentEncode(_ value: String) -> String {
        let hex = Array("0123456789ABCDEF".utf8)
        var out = [UInt8]()
        for b in value.utf8 {
            if isUnreserved(b) {
                out.append(b)
            } else {
                out.append(UInt8(ascii: "%"))
                out.append(hex[Int(b >> 4)])
                out.append(hex[Int(b & 0x0f)])
            }
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// Strict percent-decoding: `%XX` (either hex case) or a printable
    /// ASCII character that is not `%`, `&`, `=`, `#` or `+`; the result
    /// must be UTF-8. `+` is not a space here.
    static func percentDecode(_ value: ArraySlice<UInt8>) throws(QRError) -> String {
        let bytes = Array(value)
        var out = [UInt8]()
        var i = 0
        let excluded: Set<UInt8> = [
            UInt8(ascii: "&"), UInt8(ascii: "="), UInt8(ascii: "#"), UInt8(ascii: "+"),
        ]
        while i < bytes.count {
            let b = bytes[i]
            if b == UInt8(ascii: "%") {
                guard i + 2 < bytes.count, let hi = Hex.nibble(bytes[i + 1]),
                    let lo = Hex.nibble(bytes[i + 2])
                else { throw .badPercentEncoding }
                out.append(hi << 4 | lo)
                i += 3
            } else if isASCIIGraphic(b) && !excluded.contains(b) {
                out.append(b)
                i += 1
            } else {
                throw .badPercentEncoding
            }
        }
        // Decoding replaces ill-formed UTF-8 with U+FFFD, so a lossless
        // round trip is exactly "the bytes were UTF-8".
        let text = String(decoding: out, as: UTF8.self)
        guard Array(text.utf8) == out else { throw .badUTF8 }
        return text
    }
}
