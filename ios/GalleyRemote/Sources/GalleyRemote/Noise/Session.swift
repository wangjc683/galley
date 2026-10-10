import CryptoKit
import Foundation

/// The end-to-end session (design §5; Rust `noise`):
/// `Noise_NNpsk0_25519_ChaChaPoly_SHA256` over the relay's `DATA` frames,
/// phone = initiator, Core = responder.
///
/// 1. phone → Core, `psk, e`: ``clientStart(psk:)``. Empty payload, so
///    exactly ``handshakeRequestLength`` bytes.
/// 2. Core → phone, `e, ee`: ``ClientHandshake/finish(_:)``. The payload
///    is Core's hello (``CoreHello`` JSON), padded, at most
///    ``maxHelloLength`` bytes.
///
/// Transport plaintext is one padded record, `pad(type u8 ‖ body)`:
/// `0x01` APP (one app message or chunk) or `0x02` CLOSE (one reason
/// byte). ``Transport`` refuses to open anything after a failure.
public enum NoiseSession {
    /// The one Noise protocol of P0.
    public static let protocolName = "Noise_NNpsk0_25519_ChaChaPoly_SHA256"
    /// Protocol generation, first part of the prologue.
    public static let prologueTag = Data("galley-remote/1".utf8)
    public static let prologueLength = 19
    /// X25519 public key length.
    public static let dhLength = 32
    /// Handshake message 1: `e` plus the tag of the empty payload.
    public static let handshakeRequestLength = dhLength + Padding.aeadTagLength
    /// Largest Core hello in handshake message 2.
    public static let maxHelloLength = 4096
    /// A session lives at most this long; then the phone reconnects.
    public static let sessionMaxAgeSeconds: UInt64 = 24 * 60 * 60
    /// Record type of an app-layer message.
    public static let recordApp: UInt8 = 0x01
    /// Record type of the end-of-session marker.
    public static let recordClose: UInt8 = 0x02
    /// Largest app-layer message in one record; larger ones are chunked.
    public static let maxAppRecordLength = Padding.maxPayloadLength - 1

    /// The prologue both ends feed into the handshake:
    /// `galley-remote/1` ‖ `0x00` ‖ relay frame version ‖ initiator role
    /// (client) ‖ responder role (host).
    public static let prologue: Data = {
        var out = prologueTag
        out.append(0x00)
        out.append(RelayProtocol.version)
        out.append(Role.client.code)
        out.append(Role.host.code)
        return out
    }()

    /// Phone side: build handshake message 1. Send it, then hand Core's
    /// answer to ``ClientHandshake/finish(_:)``.
    public static func clientStart(psk: NoisePSK) throws(NoiseError) -> (request: Data, handshake: ClientHandshake) {
        try clientStart(psk: psk, fixedEphemeral: nil)
    }

    /// ``clientStart(psk:)`` with a fixed ephemeral key, for the golden
    /// handshake only (Rust `client_start_with_fixed_ephemeral_for_testing_only`).
    static func clientStartWithFixedEphemeralForTestingOnly(
        psk: NoisePSK, ephemeralPrivate: Data
    ) throws(NoiseError) -> (request: Data, handshake: ClientHandshake) {
        try clientStart(psk: psk, fixedEphemeral: try fixedKey(ephemeralPrivate))
    }

    private static func clientStart(
        psk: NoisePSK, fixedEphemeral: X25519PrivateKey?
    ) throws(NoiseError) -> (request: Data, handshake: ClientHandshake) {
        var state = try build(psk: psk, initiator: true, fixedEphemeral: fixedEphemeral)
        let message = try mapped { () throws(NoiseProtocolError) in try state.writeMessage(Data()) }
        guard message.count == handshakeRequestLength else {
            throw .protocolError("handshake request is \(message.count) bytes")
        }
        return (message, ClientHandshake(state: state))
    }

    /// Core side, for tests only: the phone never plays host. Fails on a
    /// wrong PSK (bad tag) or any message that is not exactly
    /// ``handshakeRequestLength`` bytes.
    static func hostAccept(psk: NoisePSK, message: Data) throws(NoiseError) -> HostHandshake {
        try hostAccept(psk: psk, message: message, fixedEphemeral: nil)
    }

    static func hostAcceptWithFixedEphemeralForTestingOnly(
        psk: NoisePSK, message: Data, ephemeralPrivate: Data
    ) throws(NoiseError) -> HostHandshake {
        try hostAccept(psk: psk, message: message, fixedEphemeral: try fixedKey(ephemeralPrivate))
    }

    private static func hostAccept(
        psk: NoisePSK, message: Data, fixedEphemeral: X25519PrivateKey?
    ) throws(NoiseError) -> HostHandshake {
        guard message.count == handshakeRequestLength else { throw .badHandshakeMessage }
        var state = try build(psk: psk, initiator: false, fixedEphemeral: fixedEphemeral)
        let payload = try mapped { () throws(NoiseProtocolError) in try state.readMessage(message) }
        guard payload.isEmpty else { throw .badHandshakeMessage }
        return HostHandshake(state: state)
    }

    /// The handshake state every session uses; only the prologue is
    /// overridable, so the cacophony NNpsk0 vector can run through it.
    static func build(
        psk: NoisePSK, initiator: Bool, fixedEphemeral: X25519PrivateKey?,
        prologue: Data = NoiseSession.prologue
    ) throws(NoiseError) -> HandshakeState {
        try mapped { () throws(NoiseProtocolError) in
            try HandshakeState(
                pattern: .nnPSK0, initiator: initiator, prologue: prologue,
                psk: psk.exposeSecret(), fixedEphemeral: fixedEphemeral)
        }
    }

    private static func fixedKey(_ raw: Data) throws(NoiseError) -> X25519PrivateKey {
        do {
            return try X25519PrivateKey(rawRepresentation: raw)
        } catch {
            throw .protocolError("fixed ephemeral key must be 32 bytes")
        }
    }

    /// Rust's `from_snow`: authentication failures are ``NoiseError/decrypt``,
    /// everything else ``NoiseError/protocolError(_:)``.
    static func mapped<T>(_ body: () throws(NoiseProtocolError) -> T) throws(NoiseError) -> T {
        do {
            return try body()
        } catch {
            switch error {
            case .decrypt: throw .decrypt
            case .nonceExhausted: throw .protocolError("nonce exhausted")
            case .invalid(let why): throw .protocolError(why)
            }
        }
    }
}

/// Why the end-to-end session failed or ended (Rust `NoiseError`).
public enum NoiseError: Error, Equatable, Sendable {
    /// A handshake message of the wrong length, or a Core hello that is
    /// empty or too long.
    case badHandshakeMessage
    /// Authentication failed: wrong PSK, a tampered, replayed or
    /// reordered message.
    case decrypt
    /// Too large for one Noise message.
    case tooLarge(len: Int, max: Int)
    case padding(PaddingError)
    /// Unknown record type, empty `APP` body, or a `CLOSE` body that is
    /// not one byte.
    case badRecord
    /// A `CLOSE` was already sent (when sealing) or received (when opening).
    case closed
    /// An earlier record failed to open; the session is unusable.
    case failed
    /// Anything else the Noise layer refused (Rust: `Protocol(String)`).
    case protocolError(String)
}

/// Phone side after message 1 went out. ``finish(_:)`` consumes it, like
/// Rust's `ClientHandshake::finish(self, …)`: a second call fails.
public final class ClientHandshake {
    private var state: HandshakeState?

    init(state: HandshakeState) {
        self.state = state
    }

    /// Read handshake message 2: Core's hello (unpadded) and the session.
    public func finish(_ message: Data) throws(NoiseError) -> (hello: Data, transport: Transport) {
        guard var state else { throw .protocolError("handshake already finished") }
        self.state = nil
        guard message.count <= Padding.maxNoiseMessageLength else { throw .badHandshakeMessage }
        let plaintext = try NoiseSession.mapped { () throws(NoiseProtocolError) in
            try state.readMessage(message)
        }
        let hello: Data
        do {
            hello = try Padding.unpad(plaintext)
        } catch {
            throw .padding(error)
        }
        guard !hello.isEmpty, hello.count <= NoiseSession.maxHelloLength else {
            throw .badHandshakeMessage
        }
        return (hello, try Transport(state))
    }
}

/// Core side after a valid message 1 (tests only).
final class HostHandshake {
    private var state: HandshakeState?

    init(state: HandshakeState) {
        self.state = state
    }

    /// Write handshake message 2 carrying `hello` (1...4096 bytes).
    func finish(hello: Data) throws(NoiseError) -> (message: Data, transport: Transport) {
        guard var state else { throw .protocolError("handshake already finished") }
        self.state = nil
        guard !hello.isEmpty, hello.count <= NoiseSession.maxHelloLength else {
            throw .tooLarge(len: hello.count, max: NoiseSession.maxHelloLength)
        }
        let plaintext: Data
        do {
            plaintext = try Padding.pad(hello)
        } catch {
            throw .padding(error)
        }
        let message = try NoiseSession.mapped { () throws(NoiseProtocolError) in
            try state.writeMessage(plaintext)
        }
        return (message, try Transport(state))
    }
}

/// Why a session ended, carried in the `CLOSE` record.
public enum CloseReason: Sendable, Hashable {
    /// `0x00`: done (app backgrounded, Core shutting down).
    case normal
    /// `0x01`: the session reached 24 hours; reconnect.
    case expired
    /// `0x02`: app protocol majors differ (design §6.2).
    case versionMismatch
    /// `0x03`: the desktop rotated its master key; scan a new code.
    case unpaired
    /// A reason this version does not know; treat as ``normal``.
    case other(UInt8)

    public var code: UInt8 {
        switch self {
        case .normal: 0x00
        case .expired: 0x01
        case .versionMismatch: 0x02
        case .unpaired: 0x03
        case .other(let code): code
        }
    }

    public init(code: UInt8) {
        switch code {
        case 0x00: self = .normal
        case 0x01: self = .expired
        case 0x02: self = .versionMismatch
        case 0x03: self = .unpaired
        default: self = .other(code)
        }
    }
}

/// One opened transport record.
public enum Record: Sendable, Hashable {
    /// One app-layer message (or chunk), as bytes.
    case app(Data)
    /// The peer ended the session; nothing more will open.
    case close(CloseReason)
}

/// An established session. A class, so it cannot be copied: each
/// direction's nonce must advance exactly once per message (Rust:
/// `Transport` is not `Clone`).
public final class Transport {
    /// Internal (not private) only so tests can seal raw plaintexts that
    /// are valid Noise but not valid records.
    var ciphers: TransportCiphers
    /// The handshake hash `h` (32 bytes), equal on both ends.
    public let handshakeHash: Data
    /// We sent `CLOSE`.
    public private(set) var sentClose = false
    /// The peer sent `CLOSE`.
    public private(set) var receivedClose = false
    private var failed = false

    init(_ state: HandshakeState) throws(NoiseError) {
        handshakeHash = state.handshakeHash
        let (send, receive) = try NoiseSession.mapped { () throws(NoiseProtocolError) in
            try state.split()
        }
        ciphers = TransportCiphers(send: send, receive: receive)
    }

    /// Seal one app-layer message (1...``NoiseSession/maxAppRecordLength`` bytes).
    public func sealApp(_ body: Data) throws(NoiseError) -> Data {
        guard !body.isEmpty, body.count <= NoiseSession.maxAppRecordLength else {
            throw .tooLarge(len: body.count, max: NoiseSession.maxAppRecordLength)
        }
        return try sealRecord(NoiseSession.recordApp, body)
    }

    /// Seal the end-of-session marker. Nothing can be sealed after it.
    public func sealClose(_ reason: CloseReason) throws(NoiseError) -> Data {
        let message = try sealRecord(NoiseSession.recordClose, Data([reason.code]))
        sentClose = true
        return message
    }

    private func sealRecord(_ type: UInt8, _ body: Data) throws(NoiseError) -> Data {
        guard !sentClose else { throw .closed }
        var content = Data([type])
        content.append(body)
        let plaintext: Data
        do {
            plaintext = try Padding.pad(content)
        } catch {
            throw .padding(error)
        }
        return try NoiseSession.mapped { () throws(NoiseProtocolError) in
            try ciphers.write(plaintext)
        }
    }

    /// Open one transport message. Any error leaves the session failed:
    /// every later ``open(_:)`` throws ``NoiseError/failed``.
    public func open(_ message: Data) throws(NoiseError) -> Record {
        if failed { throw .failed }
        if receivedClose { throw .closed }
        do {
            let record = try openRecord(message)
            if case .close = record { receivedClose = true }
            return record
        } catch {
            failed = true
            throw error
        }
    }

    private func openRecord(_ message: Data) throws(NoiseError) -> Record {
        guard message.count <= Padding.maxNoiseMessageLength else {
            throw .tooLarge(len: message.count, max: Padding.maxNoiseMessageLength)
        }
        let plaintext = try NoiseSession.mapped { () throws(NoiseProtocolError) in
            try ciphers.read(message)
        }
        let content: Data
        do {
            content = try Padding.unpad(plaintext)
        } catch {
            throw .padding(error)
        }
        guard let type = content.first else { throw .badRecord }
        let body = Data(content.dropFirst())
        switch type {
        case NoiseSession.recordApp where !body.isEmpty:
            return .app(body)
        case NoiseSession.recordClose where body.count == 1:
            return .close(CloseReason(code: body[body.startIndex]))
        default:
            throw .badRecord
        }
    }
}
