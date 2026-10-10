import CryptoKit
import Foundation
import Testing

@testable import GalleyRemote

@Suite struct NoiseTests {
    // MARK: Golden

    /// `noise-nnpsk0.json`: a whole P0 session with fixed ephemerals.
    /// Both ends run here (the host side is test-only), and every message
    /// must equal Rust's byte for byte; the phone side also opens the
    /// fixture's own host messages.
    @Test func goldenSessionMatchesRustByteForByte() throws {
        let doc = try Fixtures.golden(
            "noise-nnpsk0.json",
            keys: [
                "fixture", "description", "protocolName", "prologue", "psk", "pskSource",
                "clientEphemeralPrivate", "hostEphemeralPrivate", "handshakeHash", "recordTypes",
                "messages",
            ])
        #expect(try string(doc["protocolName"]) == NoiseSession.protocolName)
        #expect(try hex(doc["prologue"]) == NoiseSession.prologue)
        #expect(try string(doc["pskSource"]) == "keys.json noisePsk")
        let psk = fixtureMasterKey().derive().noisePSK
        #expect(try hex(doc["psk"]) == psk.exposeSecret())
        try expectKeys(doc["recordTypes"], ["app", "close"], "recordTypes")
        #expect(try int(doc["recordTypes"]?["app"]) == Int(NoiseSession.recordApp))
        #expect(try int(doc["recordTypes"]?["close"]) == Int(NoiseSession.recordClose))

        let messages = try array(doc["messages"])
        let steps = try messages.map { message -> String in
            let step = try string(message["step"])
            let record = message["record"]?.stringValue
            return record.map { "\(step):\($0)" } ?? step
        }
        #expect(
            steps == ["handshake-1", "handshake-2", "transport:app", "transport:app", "transport:close"],
            "a step the Swift side does not replay")

        // Handshake message 1, phone → Core.
        try expectKeys(messages[0], ["step", "from", "payload", "message"], "handshake-1")
        #expect(try string(messages[0]["from"]) == "client")
        #expect(try hex(messages[0]["payload"]).isEmpty)
        let (m1, client) = try NoiseSession.clientStartWithFixedEphemeralForTestingOnly(
            psk: psk, ephemeralPrivate: try hex(doc["clientEphemeralPrivate"]))
        #expect(Hex.encode(m1) == (try string(messages[0]["message"])))
        #expect(m1.count == NoiseSession.handshakeRequestLength)

        // Handshake message 2, Core → phone, carrying the padded hello.
        try expectKeys(messages[1], ["step", "from", "payloadText", "plaintext", "message"], "handshake-2")
        #expect(try string(messages[1]["from"]) == "host")
        let hello = Data(try string(messages[1]["payloadText"]).utf8)
        #expect(try Padding.pad(hello) == (try hex(messages[1]["plaintext"])))
        let host = try NoiseSession.hostAcceptWithFixedEphemeralForTestingOnly(
            psk: psk, message: m1, ephemeralPrivate: try hex(doc["hostEphemeralPrivate"]))
        let (m2, hostTransport) = try host.finish(hello: hello)
        #expect(Hex.encode(m2) == (try string(messages[1]["message"])))
        let (gotHello, clientTransport) = try client.finish(try hex(messages[1]["message"]))
        #expect(gotHello == hello)
        #expect(Hex.encode(clientTransport.handshakeHash) == (try string(doc["handshakeHash"])))
        #expect(clientTransport.handshakeHash == hostTransport.handshakeHash)
        let coreHello = try JSONValue(parsing: gotHello).decode(CoreHello.self)
        #expect(coreHello.protocol == .current)

        // The APP records and the CLOSE.
        for (index, message) in messages.enumerated().dropFirst(2) {
            let from = try string(message["from"])
            let (sender, receiver) =
                from == "client" ? (clientTransport, hostTransport) : (hostTransport, clientTransport)
            let expected = try string(message["message"])
            switch try string(message["record"]) {
            case "app":
                try expectKeys(
                    message, ["step", "from", "record", "bodyText", "plaintext", "message"], "message \(index)")
                let body = Data(try string(message["bodyText"]).utf8)
                #expect(try Padding.pad(Data([NoiseSession.recordApp]) + body) == (try hex(message["plaintext"])))
                #expect(Hex.encode(try sender.sealApp(body)) == expected, "message \(index)")
                #expect(try receiver.open(hex(expected)) == .app(body), "message \(index)")
            case "close":
                try expectKeys(
                    message, ["step", "from", "record", "closeReason", "plaintext", "message"],
                    "message \(index)")
                let reason = CloseReason(code: UInt8(try int(message["closeReason"])))
                #expect(reason == .normal)
                #expect(
                    try Padding.pad(Data([NoiseSession.recordClose, reason.code]))
                        == (try hex(message["plaintext"])))
                #expect(Hex.encode(try sender.sealClose(reason)) == expected, "message \(index)")
                #expect(try receiver.open(hex(expected)) == .close(reason), "message \(index)")
                #expect(sender.sentClose && receiver.receivedClose)
            case let other:
                Issue.record("record type \(other) the Swift side does not know")
            }
        }
    }

    // MARK: Mirrors of the Rust unit tests (`src/noise.rs`)

    func psk(_ seed: UInt8) -> NoisePSK {
        try! MasterKey(bytes: Data(repeating: seed, count: 32)).derive().noisePSK
    }

    func pair() throws -> (client: Transport, host: Transport) {
        let (m1, client) = try NoiseSession.clientStart(psk: psk(1))
        let host = try NoiseSession.hostAccept(psk: psk(1), message: m1)
        let (m2, hostTransport) = try host.finish(hello: Data(#"{"hello":1}"#.utf8))
        let (hello, clientTransport) = try client.finish(m2)
        #expect(hello == Data(#"{"hello":1}"#.utf8))
        #expect(clientTransport.handshakeHash == hostTransport.handshakeHash)
        return (clientTransport, hostTransport)
    }

    @Test func prologueBytes() {
        #expect(NoiseSession.prologue == Data("galley-remote/1".utf8) + Data([0x00, 0x01, 0x02, 0x01]))
        #expect(Hex.encode(NoiseSession.prologue) == "67616c6c65792d72656d6f74652f3100010201")
        #expect(NoiseSession.prologue.count == NoiseSession.prologueLength)
    }

    @Test func handshakeAndRecordsBothWays() throws {
        let (client, host) = try pair()
        let m = try client.sealApp(Data("ping".utf8))
        #expect(m.count == 256 + Padding.aeadTagLength, "small records pad to 256")
        #expect(try host.open(m) == .app(Data("ping".utf8)))
        let big = Data(repeating: UInt8(ascii: "x"), count: NoiseSession.maxAppRecordLength)
        let m2 = try host.sealApp(big)
        #expect(m2.count == Padding.maxNoiseMessageLength)
        #expect(try client.open(m2) == .app(big))
        let oversize = thrown { () throws(NoiseError) in
            try host.sealApp(Data(count: NoiseSession.maxAppRecordLength + 1))
        }
        #expect(oversize == .tooLarge(len: NoiseSession.maxAppRecordLength + 1, max: NoiseSession.maxAppRecordLength))
        #expect(thrown { () throws(NoiseError) in try host.sealApp(Data()) } == .tooLarge(len: 0, max: NoiseSession.maxAppRecordLength))
    }

    @Test func closeEndsEachDirection() throws {
        let (client, host) = try pair()
        let close = try client.sealClose(.expired)
        #expect(thrown { () throws(NoiseError) in try client.sealApp(Data("late".utf8)) } == .closed)
        #expect(try host.open(close) == .close(.expired))
        #expect(host.receivedClose)
        // The host may still answer until it closes too; the client reads it.
        let m = try host.sealApp(Data("bye".utf8))
        #expect(try client.open(m) == .app(Data("bye".utf8)))
        let after = try host.sealApp(Data("after".utf8))
        #expect(thrown { () throws(NoiseError) in try host.open(after) } == .closed, "nothing opens after CLOSE")
        #expect(CloseReason(code: 0x7f) == .other(0x7f))
        #expect(CloseReason(code: 0x03) == .unpaired)
        #expect(CloseReason.versionMismatch.code == 0x02)
    }

    @Test func wrongPSKFailsAtMessageOne() throws {
        let (m1, _) = try NoiseSession.clientStart(psk: psk(1))
        #expect(thrown { () throws(NoiseError) in try NoiseSession.hostAccept(psk: psk(2), message: m1) } == .decrypt)
        #expect(
            thrown { () throws(NoiseError) in try NoiseSession.hostAccept(psk: psk(1), message: m1.prefix(47)) }
                == .badHandshakeMessage)
        #expect(
            thrown { () throws(NoiseError) in try NoiseSession.hostAccept(psk: psk(1), message: m1 + Data([0])) }
                == .badHandshakeMessage)
    }

    @Test func tamperedMessageTwoIsRejected() throws {
        let (m1, client) = try NoiseSession.clientStart(psk: psk(1))
        var (m2, _) = try NoiseSession.hostAccept(psk: psk(1), message: m1).finish(hello: Data("{}".utf8))
        m2[m2.count - 1] ^= 1
        #expect(thrown { () throws(NoiseError) in try client.finish(m2) } == .decrypt)
        // Like Rust's `finish(self)`, the handshake is spent either way.
        #expect(thrown { () throws(NoiseError) in try client.finish(m2) } == .protocolError("handshake already finished"))
    }

    @Test func messageTwoUnderAnotherPSKIsRejected() throws {
        let (_, client) = try NoiseSession.clientStart(psk: psk(1))
        let (other, _) = try NoiseSession.clientStart(psk: psk(2))
        let (m2, _) = try NoiseSession.hostAccept(psk: psk(2), message: other).finish(hello: Data("{}".utf8))
        #expect(thrown { () throws(NoiseError) in try client.finish(m2) } == .decrypt)
    }

    @Test func helloSizeLimits() throws {
        let (m1, _) = try NoiseSession.clientStart(psk: psk(1))
        let host = try NoiseSession.hostAccept(psk: psk(1), message: m1)
        #expect(thrown { () throws(NoiseError) in try host.finish(hello: Data()) } == .tooLarge(len: 0, max: 4096))
        let host2 = try NoiseSession.hostAccept(psk: psk(1), message: m1)
        #expect(
            thrown { () throws(NoiseError) in try host2.finish(hello: Data(count: NoiseSession.maxHelloLength + 1)) }
                == .tooLarge(len: 4097, max: 4096))
    }

    @Test func tamperingReplayAndReorderingFailTheSession() throws {
        do {
            let (client, host) = try pair()
            let first = try client.sealApp(Data("one".utf8))
            let second = try client.sealApp(Data("two".utf8))
            #expect(thrown { () throws(NoiseError) in try host.open(second) } == .decrypt, "reordered")
            #expect(thrown { () throws(NoiseError) in try host.open(first) } == .failed, "session is dead")
        }
        do {
            let (client, host) = try pair()
            let m = try client.sealApp(Data("one".utf8))
            #expect(try host.open(m) == .app(Data("one".utf8)))
            #expect(thrown { () throws(NoiseError) in try host.open(m) } == .decrypt, "replay")
        }
        do {
            let (client, host) = try pair()
            var m = try client.sealApp(Data("one".utf8))
            m[3] ^= 0x80
            #expect(thrown { () throws(NoiseError) in try host.open(m) } == .decrypt)
        }
        do {
            let (_, host) = try pair()
            #expect(thrown { () throws(NoiseError) in try host.open(Data(count: 15)) } == .decrypt, "shorter than a tag")
            let (_, host2) = try pair()
            #expect(
                thrown { () throws(NoiseError) in try host2.open(Data(count: 65536)) }
                    == .tooLarge(len: 65536, max: 65535))
            #expect(thrown { () throws(NoiseError) in try host2.open(Data(count: 32)) } == .failed)
        }
    }

    @Test func malformedRecordsFailTheSession() throws {
        let cases: [(Data, NoiseError)] = [
            (try Padding.pad(Data([0x09, 1])), .badRecord),
            (try Padding.pad(Data([NoiseSession.recordApp])), .badRecord),
            (try Padding.pad(Data([NoiseSession.recordClose])), .badRecord),
            (try Padding.pad(Data([NoiseSession.recordClose, 0, 0])), .badRecord),
            (try Padding.pad(Data()), .badRecord),
            (Data([0, 1, NoiseSession.recordApp]), .padding(.nonCanonicalSize(expected: 256, actual: 3))),
        ]
        for (plaintext, expected) in cases {
            let (client, host) = try pair()
            let m = try client.ciphers.write(plaintext)
            #expect(thrown { () throws(NoiseError) in try host.open(m) } == expected)
            #expect(thrown { () throws(NoiseError) in try host.open(m) } == .failed)
        }
    }

    @Test func handshakeRefusesOutOfTurnMessages() throws {
        var state = try NoiseSession.build(psk: psk(1), initiator: true, fixedEphemeral: nil)
        #expect(thrown { () throws(NoiseProtocolError) in try state.readMessage(Data(count: 48)) } != nil)
        _ = try state.writeMessage(Data())
        #expect(thrown { () throws(NoiseProtocolError) in try state.writeMessage(Data()) } != nil)
        #expect(thrown { () throws(NoiseProtocolError) in try state.split() } != nil)
    }

    @Test func nonceAndRekeyFollowTheSpec() throws {
        // §5.1: n = 2^64 - 1 is reserved.
        var cipher = CipherState(key: .init(size: .bits256))
        cipher.setNonce(UInt64.max)
        #expect(thrown { () throws(NoiseProtocolError) in try cipher.encrypt(ad: Data(), plaintext: Data()) } == .nonceExhausted)
        // A rekeyed pair still talks; the old key no longer opens.
        let key = SymmetricKey(size: .bits256)
        var a = CipherState(key: key)
        var b = CipherState(key: key)
        a.rekey()
        b.rekey()
        let sealed = try a.encrypt(ad: Data(), plaintext: Data("x".utf8))
        #expect(try b.decrypt(ad: Data(), ciphertext: sealed) == Data("x".utf8))
        var stale = CipherState(key: key)
        stale.setNonce(1)
        let fresh = try a.encrypt(ad: Data(), plaintext: Data("y".utf8))
        #expect(thrown { () throws(NoiseProtocolError) in try stale.decrypt(ad: Data(), ciphertext: fresh) } == .decrypt)
    }
}
