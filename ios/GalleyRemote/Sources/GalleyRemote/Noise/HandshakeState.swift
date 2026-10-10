import CryptoKit
import Foundation

/// §7 message tokens.
enum NoiseToken: Equatable {
    case e, s, ee, es, se, ss, psk
}

/// §7 handshake patterns with §9 PSK modifiers. Only the three Galley
/// uses or plans to use (design §5, §3.2); they are also the three
/// vendored cacophony vectors.
struct HandshakePattern: Equatable {
    let name: String
    /// Pre-message of the initiator, then of the responder (`s` only here).
    let initiatorPreMessage: [NoiseToken]
    let responderPreMessage: [NoiseToken]
    /// Alternating initiator → responder, responder → initiator, …
    let messages: [[NoiseToken]]

    /// A pattern with a `psk` token is in PSK mode: every `e` token is
    /// also mixed into the key (§9.2).
    var isPSKMode: Bool { messages.contains { $0.contains(.psk) } }

    /// P0 (design §5): `-> psk, e` / `<- e, ee`.
    static let nnPSK0 = HandshakePattern(
        name: "NNpsk0", initiatorPreMessage: [], responderPreMessage: [],
        messages: [[.psk, .e], [.e, .ee]])

    /// P1 pairing (design §3.2): `-> e` / `<- e, ee, s, es` / `-> s, se, psk`.
    static let xxPSK3 = HandshakePattern(
        name: "XXpsk3", initiatorPreMessage: [], responderPreMessage: [],
        messages: [[.e], [.e, .ee, .s, .es], [.s, .se, .psk]])

    /// P1 sessions (design §3.2): `-> s` `<- s` ... `-> e, es, ss` / `<- e, ee, se`.
    static let kk = HandshakePattern(
        name: "KK", initiatorPreMessage: [.s], responderPreMessage: [.s],
        messages: [[.e, .es, .ss], [.e, .ee, .se]])

    static let all: [HandshakePattern] = [.nnPSK0, .xxPSK3, .kk]

    /// `Noise_<pattern>_25519_ChaChaPoly_SHA256`.
    var protocolName: String { "Noise_\(name)_25519_ChaChaPoly_SHA256" }

    /// The pattern of a full protocol name in this suite, if known.
    static func fromProtocolName(_ protocolName: String) -> HandshakePattern? {
        all.first { $0.protocolName == protocolName }
    }
}

typealias X25519PrivateKey = Curve25519.KeyAgreement.PrivateKey
typealias X25519PublicKey = Curve25519.KeyAgreement.PublicKey

/// §5.3 HandshakeState, generic over ``HandshakePattern``.
struct HandshakeState {
    let pattern: HandshakePattern
    let initiator: Bool
    private var symmetric: SymmetricState
    private var s: X25519PrivateKey?
    private var e: X25519PrivateKey?
    private var rs: X25519PublicKey?
    private var re: X25519PublicKey?
    private let psk: Data?
    /// The key the next `e` token writes instead of a fresh one: snow's
    /// `fixed_ephemeral_key_for_testing_only`, for vectors and fixtures.
    private var fixedEphemeral: X25519PrivateKey?
    private(set) var messageIndex = 0

    /// Initialize(): `localStatic` / `remoteStatic` as the pattern needs
    /// them, a 32-byte `psk` iff it has a `psk` token.
    init(
        pattern: HandshakePattern, initiator: Bool, prologue: Data,
        localStatic: X25519PrivateKey? = nil, remoteStatic: X25519PublicKey? = nil,
        psk: Data? = nil, fixedEphemeral: X25519PrivateKey? = nil
    ) throws(NoiseProtocolError) {
        self.pattern = pattern
        self.initiator = initiator
        self.symmetric = SymmetricState(protocolName: pattern.protocolName)
        self.s = localStatic
        self.rs = remoteStatic
        self.fixedEphemeral = fixedEphemeral
        if pattern.isPSKMode {
            guard let psk, psk.count == 32 else { throw .invalid("pattern needs a 32-byte psk") }
            self.psk = psk
        } else {
            guard psk == nil else { throw .invalid("pattern takes no psk") }
            self.psk = nil
        }
        symmetric.mixHash(prologue)
        // Pre-messages: the initiator's public keys first (§7.1).
        for (owner, tokens) in [(true, pattern.initiatorPreMessage), (false, pattern.responderPreMessage)] {
            let mine = owner == initiator
            for token in tokens {
                guard token == .s else { throw .invalid("unsupported pre-message token") }
                let key = mine ? s?.publicKey : rs
                guard let key else { throw .invalid("pattern needs a static key") }
                symmetric.mixHash(key.rawRepresentation)
            }
        }
    }

    var isFinished: Bool { messageIndex >= pattern.messages.count }

    private var isOurTurn: Bool { (messageIndex % 2 == 0) == initiator }

    var handshakeHash: Data { symmetric.h }

    /// WriteMessage(payload, message_buffer).
    mutating func writeMessage(_ payload: Data) throws(NoiseProtocolError) -> Data {
        guard !isFinished, isOurTurn else { throw .invalid("not our turn to write") }
        var out = Data()
        for token in pattern.messages[messageIndex] {
            switch token {
            case .e:
                let key = fixedEphemeral ?? X25519PrivateKey()
                fixedEphemeral = nil
                e = key
                let pub = key.publicKey.rawRepresentation
                out.append(pub)
                symmetric.mixHash(pub)
                if pattern.isPSKMode { symmetric.mixKey(pub) }
            case .s:
                guard let s else { throw .invalid("no local static key") }
                out.append(try symmetric.encryptAndHash(s.publicKey.rawRepresentation))
            case .ee, .es, .se, .ss:
                symmetric.mixKey(try dh(token))
            case .psk:
                symmetric.mixKeyAndHash(psk!)
            }
        }
        out.append(try symmetric.encryptAndHash(payload))
        guard out.count <= NoisePrimitives.maxMessageLength else {
            throw .invalid("handshake message too long")
        }
        messageIndex += 1
        return out
    }

    /// ReadMessage(message, payload_buffer).
    mutating func readMessage(_ message: Data) throws(NoiseProtocolError) -> Data {
        guard !isFinished, !isOurTurn else { throw .invalid("not our turn to read") }
        guard message.count <= NoisePrimitives.maxMessageLength else {
            throw .invalid("handshake message too long")
        }
        var reader = ByteReader(message)
        for token in pattern.messages[messageIndex] {
            switch token {
            case .e:
                guard let raw = reader.take(NoisePrimitives.dhLength) else {
                    throw .invalid("handshake message too short")
                }
                re = try publicKey(raw)
                symmetric.mixHash(raw)
                if pattern.isPSKMode { symmetric.mixKey(raw) }
            case .s:
                let length = NoisePrimitives.dhLength
                    + (symmetric.cipher.hasKey ? NoisePrimitives.tagLength : 0)
                guard let temp = reader.take(length) else {
                    throw .invalid("handshake message too short")
                }
                rs = try publicKey(try symmetric.decryptAndHash(temp))
            case .ee, .es, .se, .ss:
                symmetric.mixKey(try dh(token))
            case .psk:
                symmetric.mixKeyAndHash(psk!)
            }
        }
        let payload = try symmetric.decryptAndHash(reader.rest())
        messageIndex += 1
        return payload
    }

    /// Split() into this side's (send, receive) ciphers (§5.3: the
    /// initiator sends with the first, the responder with the second).
    func split() throws(NoiseProtocolError) -> (send: CipherState, receive: CipherState) {
        guard isFinished else { throw .invalid("handshake not finished") }
        let (c1, c2) = symmetric.split()
        return initiator ? (c1, c2) : (c2, c1)
    }

    private func publicKey(_ raw: Data) throws(NoiseProtocolError) -> X25519PublicKey {
        do {
            return try X25519PublicKey(rawRepresentation: raw)
        } catch {
            throw .invalid("bad public key")
        }
    }

    /// The DH of a two-letter token: first letter is the initiator's key,
    /// second the responder's (§7).
    private func dh(_ token: NoiseToken) throws(NoiseProtocolError) -> Data {
        let local: X25519PrivateKey?
        let remote: X25519PublicKey?
        switch (token, initiator) {
        case (.ee, _): (local, remote) = (e, re)
        case (.ss, _): (local, remote) = (s, rs)
        case (.es, true): (local, remote) = (e, rs)
        case (.es, false): (local, remote) = (s, re)
        case (.se, true): (local, remote) = (s, re)
        case (.se, false): (local, remote) = (e, rs)
        default: throw .invalid("not a DH token")
        }
        guard let local, let remote else { throw .invalid("missing key for \(token)") }
        return try NoisePrimitives.dh(local, remote)
    }
}

/// The two transport ciphers after Split(), one per direction.
struct TransportCiphers {
    private var send: CipherState
    private var receive: CipherState

    init(send: CipherState, receive: CipherState) {
        self.send = send
        self.receive = receive
    }

    mutating func write(_ payload: Data) throws(NoiseProtocolError) -> Data {
        guard payload.count + NoisePrimitives.tagLength <= NoisePrimitives.maxMessageLength else {
            throw .invalid("transport message too long")
        }
        return try send.encrypt(ad: Data(), plaintext: payload)
    }

    mutating func read(_ message: Data) throws(NoiseProtocolError) -> Data {
        guard message.count <= NoisePrimitives.maxMessageLength else {
            throw .invalid("transport message too long")
        }
        return try receive.decrypt(ad: Data(), ciphertext: message)
    }
}
