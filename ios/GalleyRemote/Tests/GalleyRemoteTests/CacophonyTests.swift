import CryptoKit
import Foundation
import Testing

@testable import GalleyRemote

/// The vendored cacophony vectors (`remote-protocol/tests/vectors/`), the
/// same file the Rust crate runs against snow.
@Suite struct CacophonyTests {
    static let protocolNames = [
        "Noise_NNpsk0_25519_ChaChaPoly_SHA256",
        "Noise_XXpsk3_25519_ChaChaPoly_SHA256",
        "Noise_KK_25519_ChaChaPoly_SHA256",
    ]

    static func vector(_ protocolName: String) throws -> JSONValue {
        let file = try Fixtures.load(Fixtures.vectorsFile)
        let vectors = try array(file["vectors"])
        return try #require(vectors.first { $0["protocol_name"]?.stringValue == protocolName })
    }

    /// The file holds exactly the suites this package implements, each
    /// with six messages; a vector added on the Rust side fails here.
    @Test func vendoredFileHoldsTheKnownSuites() throws {
        let file = try Fixtures.load(Fixtures.vectorsFile)
        try expectKeys(file, ["vectors"], "cacophony-subset.json")
        let vectors = try array(file["vectors"])
        #expect(try vectors.map { try string($0["protocol_name"]) } == Self.protocolNames)
        for vector in vectors {
            #expect(try array(vector["messages"]).count == 6)
            let name = try string(vector["protocol_name"])
            #expect(HandshakePattern.fromProtocolName(name) != nil, "\(name) has no Swift pattern")
        }
    }

    @Test(arguments: protocolNames)
    func vectorPassesByteForByte(protocolName: String) throws {
        let vector = try Self.vector(protocolName)
        let pattern = try #require(HandshakePattern.fromProtocolName(protocolName))

        func side(_ prefix: String, initiator: Bool) throws -> HandshakeState {
            let psk = try vector["\(prefix)_psks"].map { try hex(try array($0).first) }
            let localStatic = try vector["\(prefix)_static"].map {
                try X25519PrivateKey(rawRepresentation: try hex($0))
            }
            let remoteStatic = try vector["\(prefix)_remote_static"].map {
                try X25519PublicKey(rawRepresentation: try hex($0))
            }
            return try HandshakeState(
                pattern: pattern, initiator: initiator, prologue: try hex(vector["\(prefix)_prologue"]),
                localStatic: localStatic, remoteStatic: remoteStatic, psk: psk,
                fixedEphemeral: try X25519PrivateKey(rawRepresentation: try hex(vector["\(prefix)_ephemeral"])))
        }
        var initiator = try side("init", initiator: true)
        var responder = try side("resp", initiator: false)
        let messages = try array(vector["messages"])

        var index = 0
        while !initiator.isFinished {
            let payload = try hex(messages[index]["payload"])
            let expected = try hex(messages[index]["ciphertext"])
            let sent: Data
            let received: Data
            if index % 2 == 0 {
                sent = try initiator.writeMessage(payload)
                received = try responder.readMessage(sent)
            } else {
                sent = try responder.writeMessage(payload)
                received = try initiator.readMessage(sent)
            }
            #expect(Hex.encode(sent) == Hex.encode(expected), "\(protocolName) message \(index)")
            #expect(received == payload, "\(protocolName) message \(index)")
            index += 1
        }
        #expect(responder.isFinished)
        #expect(Hex.encode(initiator.handshakeHash) == (try string(vector["handshake_hash"])))
        #expect(initiator.handshakeHash == responder.handshakeHash)

        let (iSend, iReceive) = try initiator.split()
        let (rSend, rReceive) = try responder.split()
        var initiatorTransport = TransportCiphers(send: iSend, receive: iReceive)
        var responderTransport = TransportCiphers(send: rSend, receive: rReceive)
        while index < messages.count {
            let payload = try hex(messages[index]["payload"])
            let expected = try hex(messages[index]["ciphertext"])
            let sent: Data
            let received: Data
            if index % 2 == 0 {
                sent = try initiatorTransport.write(payload)
                received = try responderTransport.read(sent)
            } else {
                sent = try responderTransport.write(payload)
                received = try initiatorTransport.read(sent)
            }
            #expect(Hex.encode(sent) == Hex.encode(expected), "\(protocolName) message \(index)")
            #expect(received == payload, "\(protocolName) message \(index)")
            index += 1
        }
    }

    /// The NNpsk0 vector through the builder every session uses (only the
    /// prologue and the ephemerals come from the vector), as the Rust
    /// crate's in-module test does.
    @Test func nnPSK0VectorThroughTheSessionBuilder() throws {
        let vector = try Self.vector(NoiseSession.protocolName)
        let psk = try NoisePSK(bytes: try hex(try array(vector["init_psks"]).first))
        var initiator = try NoiseSession.build(
            psk: psk, initiator: true,
            fixedEphemeral: try X25519PrivateKey(rawRepresentation: try hex(vector["init_ephemeral"])),
            prologue: try hex(vector["init_prologue"]))
        var responder = try NoiseSession.build(
            psk: psk, initiator: false,
            fixedEphemeral: try X25519PrivateKey(rawRepresentation: try hex(vector["resp_ephemeral"])),
            prologue: try hex(vector["resp_prologue"]))
        let messages = try array(vector["messages"])
        let m1 = try initiator.writeMessage(try hex(messages[0]["payload"]))
        #expect(m1 == (try hex(messages[0]["ciphertext"])))
        _ = try responder.readMessage(m1)
        let m2 = try responder.writeMessage(try hex(messages[1]["payload"]))
        #expect(m2 == (try hex(messages[1]["ciphertext"])))
        #expect(try initiator.readMessage(m2) == (try hex(messages[1]["payload"])))
        #expect(initiator.handshakeHash == (try hex(vector["handshake_hash"])))
    }
}
