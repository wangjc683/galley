import Foundation
import Testing

@testable import GalleyRemote

@Suite struct KeysTests {
    // MARK: Golden

    @Test func goldenKeysAndQR() throws {
        let doc = try Fixtures.golden(
            "keys.json",
            keys: [
                "fixture", "description", "masterKey", "masterKeyBase64url", "hkdf", "channelSecret",
                "channelSecretHeader", "channelKey", "noisePsk", "pushKey", "qr", "qrInvalid",
            ])
        let mk = fixtureMasterKey()
        #expect(try hex(doc["masterKey"]) == mk.exposeSecret())
        #expect(try string(doc["masterKeyBase64url"]) == mk.base64url)
        #expect(try MasterKey(base64url: string(doc["masterKeyBase64url"])).exposeSecret() == mk.exposeSecret())

        try expectKeys(doc["hkdf"], ["salt", "info"], "hkdf")
        try expectKeys(doc["hkdf"]?["info"], ["channelSecret", "noisePsk", "pushKey"], "hkdf.info")
        #expect(Data(try string(doc["hkdf"]?["salt"]).utf8) == PairingKeys.hkdfSalt)
        #expect(Data(try string(doc["hkdf"]?["info"]?["channelSecret"]).utf8) == PairingKeys.infoChannel)
        #expect(Data(try string(doc["hkdf"]?["info"]?["noisePsk"]).utf8) == PairingKeys.infoNoisePSK)
        #expect(Data(try string(doc["hkdf"]?["info"]?["pushKey"]).utf8) == PairingKeys.infoPush)

        let keys = mk.derive()
        #expect(try hex(doc["channelSecret"]) == keys.channelSecret.exposeSecret())
        #expect(try string(doc["channelSecretHeader"]) == keys.channelSecret.headerValue)
        #expect(try hex(doc["channelKey"]) == keys.channelSecret.channelKey.bytes)
        #expect(try hex(doc["noisePsk"]) == keys.noisePSK.exposeSecret())
        #expect(try hex(doc["pushKey"]) == keys.pushKey.exposeSecret())

        let qr = doc["qr"]
        try expectKeys(qr, ["string", "relay", "relayConnectUrl", "desktopName"], "qr")
        let relay = try RelayURL.parse(string(qr?["relay"]))
        let code = try PairingCode(relay: relay, masterKey: mk, desktopName: string(qr?["desktopName"]))
        #expect(code.qrString == (try string(qr?["string"])), "Swift builds the same QR string")
        let parsed = try PairingCode.parse(string(qr?["string"]))
        #expect(parsed.relay.url == (try string(qr?["relay"])))
        #expect(parsed.relay.connectURL == (try string(qr?["relayConnectUrl"])))
        #expect(parsed.desktopName == (try string(qr?["desktopName"])))
        #expect(parsed.masterKey.exposeSecret() == mk.exposeSecret())

        for case let item in try array(doc["qrInvalid"]) {
            try expectKeys(item, ["input", "why", "rustError"], "qrInvalid")
            let why = try string(item["why"])
            let input = try string(item["input"])
            let error = try #require(thrown { () throws(QRError) in try PairingCode.parse(input) }, "\(why) accepted")
            #expect(rustDebug(error) == (try string(item["rustError"])), "\(why)")
        }
    }

    // MARK: Mirrors of the Rust unit tests (`src/keys.rs`)

    func code() -> PairingCode {
        try! PairingCode(
            relay: RelayURL.parse("wss://relay.example.com"), masterKey: fixtureMasterKey(),
            desktopName: "JC 的 MacBook")
    }

    @Test func derivedKeysAreDistinctAndDeterministic() {
        let a = fixtureMasterKey().derive()
        let b = fixtureMasterKey().derive()
        #expect(a.channelSecret.exposeSecret() == b.channelSecret.exposeSecret())
        #expect(a.channelSecret.exposeSecret() != a.noisePSK.exposeSecret())
        #expect(a.noisePSK.exposeSecret() != a.pushKey.exposeSecret())
        #expect(a.channelSecret.exposeSecret() != fixtureMasterKey().exposeSecret())
    }

    @Test func descriptionsNeverPrintKeyBytes() {
        let mk = fixtureMasterKey()
        let keys = mk.derive()
        var dumped = ""
        dump(keys, to: &dumped)
        dump(code(), to: &dumped)
        let text = "\(mk) \(keys) \(String(reflecting: mk)) \(code()) \(dumped)"
        #expect(text.contains("<redacted>"))
        #expect(!text.contains(mk.base64url))
        #expect(!text.contains(Hex.encode(mk.exposeSecret())))
        #expect(!text.contains(Hex.encode(keys.pushKey.exposeSecret())))
        #expect("\(keys.channelSecret.channelKey)" == "ChannelKey(<redacted>)")
    }

    @Test func generateGivesFreshKeys() {
        #expect(MasterKey.generate().exposeSecret() != MasterKey.generate().exposeSecret())
        #expect(MasterKey.generate().exposeSecret().count == 32)
    }

    @Test func wrongKeyLengthsAreRefused() {
        for count in [0, 31, 33] {
            let bytes = Data(count: count)
            #expect(thrown { () throws(KeyError) in try MasterKey(bytes: bytes) } == .badLength(expected: 32, actual: count))
            #expect(thrown { () throws(KeyError) in try NoisePSK(bytes: bytes) } == .badLength(expected: 32, actual: count))
            #expect(thrown { () throws(KeyError) in try PushKey(bytes: bytes) } == .badLength(expected: 32, actual: count))
            #expect(thrown { () throws(KeyError) in try ChannelSecret(bytes: bytes) } == .badLength(expected: 32, actual: count))
        }
    }

    @Test func channelHeaderRoundTripsStrictly() throws {
        let secret = fixtureMasterKey().derive().channelSecret
        let header = secret.headerValue
        #expect(header.count == 43)
        #expect(try ChannelSecret(headerValue: header).exposeSecret() == secret.exposeSecret())
        #expect(thrown { () throws(KeyError) in try ChannelSecret(headerValue: header + "=") } == .badBase64)
        #expect(
            thrown { () throws(KeyError) in try ChannelSecret(headerValue: String(header.prefix(42))) } == .badBase64,
            "42 chars leave non-canonical trailing bits")
        #expect(thrown { () throws(KeyError) in try ChannelSecret(headerValue: "AAAA") } == .badLength(expected: 32, actual: 3))
    }

    @Test func qrRoundTrips() throws {
        let qr = code().qrString
        #expect(qr.hasPrefix("galley-pair:1?relay=wss%3A%2F%2Frelay.example.com&mk="))
        #expect(qr.hasSuffix("&name=JC%20%E7%9A%84%20MacBook"))
        let back = try PairingCode.parse(qr)
        #expect(back.relay == code().relay)
        #expect(back.desktopName == "JC 的 MacBook")
        #expect(back.masterKey.exposeSecret() == fixtureMasterKey().exposeSecret())
    }

    @Test func qrAcceptsAnyFieldOrderAndLowercaseHex() throws {
        let qr = "galley-pair:1?name=Mac%e7%9a%84&mk=\(fixtureMasterKey().base64url)&relay=wss://relay.example.com/"
        let code = try PairingCode.parse(qr)
        #expect(code.desktopName == "Mac的")
        #expect(code.relay.url == "wss://relay.example.com")
    }

    @Test func qrRejectsMalformedInput() {
        let mk64 = fixtureMasterKey().base64url
        func good(_ relay: String, _ mk: String, _ name: String) -> String {
            "galley-pair:1?relay=\(relay)&mk=\(mk)&name=\(name)"
        }
        let r = "wss%3A%2F%2Frelay.example.com"
        let cases: [(String, QRError)] = [
            (good(r, mk64, "Mac").replacingOccurrences(of: "pair:1", with: "pair:2"), .badPrefix),
            (good(r, mk64, "Mac").replacingOccurrences(of: "galley-pair", with: "Galley-pair"), .badPrefix),
            (good(r, mk64, "Mac") + "&x=1", .unknownKey("x")),
            (good(r, mk64, "Mac") + "&name=b", .duplicateKey("name")),
            ("galley-pair:1?relay=\(r)&mk=\(mk64)", .missingKey("name")),
            (good(r, mk64, "Mac") + "&", .malformedQuery),
            ("galley-pair:1?", .malformedQuery),
            (good(r, mk64, "Mac%2"), .badPercentEncoding),
            (good(r, mk64, "Mac%zz"), .badPercentEncoding),
            (good(r, mk64, "Mac Book"), .badPercentEncoding),
            (good(r, mk64, "Mac+Book"), .badPercentEncoding),
            (good(r, mk64, "%FF"), .badUTF8),
            (good(r, mk64, "%0A"), .badDesktopName),
            (good(r, mk64, "%20"), .badDesktopName),
            (good(r, mk64, ""), .badDesktopName),
            (good(r, mk64, String(repeating: "a", count: 129)), .badDesktopName),
            (good(r, mk64 + "=", "Mac"), .badMasterKey(.badBase64)),
            (good(r, String(mk64.prefix(40)), "Mac"), .badMasterKey(.badLength(expected: 32, actual: 30))),
            (good(r, mk64.replacingOccurrences(of: "A", with: "+"), "Mac"), .badMasterKey(.badBase64)),
            (good("http%3A%2F%2Fx.com", mk64, "Mac"), .badRelayURL(.badScheme)),
            (good("ws%3A%2F%2Frelay.example.com", mk64, "Mac"), .badRelayURL(.insecureRemote)),
            (good(r, mk64, String(repeating: "a", count: 2048)), .tooLong),
            // Swift-side extras: the same rules on inputs Rust's list skips.
            (good(r, mk64, "%E2%80%A8"), .badDesktopName),  // U+2028 is whitespace, so blank
            (good(r, mk64, "Mac%C2%85"), .badDesktopName),  // U+0085 is a control character
            (good(r, mk64, "Mac%e7%9a"), .badUTF8),
            ("galley-pair:1?relay&mk=\(mk64)&name=a", .malformedQuery),
            ("galley-pair:1?relay=\(r)&name=a", .missingKey("mk")),
            ("galley-pair:1?mk=\(mk64)&name=a", .missingKey("relay")),
        ]
        for (input, expected) in cases {
            #expect(thrown { () throws(QRError) in try PairingCode.parse(input) } == expected, "\(input)")
        }
    }

    @Test func qrErrorsNeverEchoTheKey() {
        let mk64 = fixtureMasterKey().base64url
        let error = thrown { () throws(QRError) in
            try PairingCode.parse("galley-pair:1?relay=ws%3A%2F%2Fevil.com&mk=\(mk64)&name=a")
        }
        #expect(error == .badRelayURL(.insecureRemote))
        #expect(!"\(String(describing: error))".contains(mk64))
    }

    @Test func relayURLRules() throws {
        let ok: [(String, String)] = [
            ("wss://relay.example.com", "wss://relay.example.com"),
            ("wss://Relay.Example.com:8443/", "wss://relay.example.com:8443"),
            ("wss://relay.example.com/galley/", "wss://relay.example.com/galley"),
            ("ws://localhost:8787", "ws://localhost:8787"),
            ("ws://127.0.0.1:8787", "ws://127.0.0.1:8787"),
            ("ws://127.1.2.3", "ws://127.1.2.3"),
            ("ws://[::1]:8787", "ws://[::1]:8787"),
            ("wss://[2001:db8::1]", "wss://[2001:db8::1]"),
            // Swift-side extras.
            ("ws://LOCALHOST", "ws://localhost"),
            ("ws://[0:0:0:0:0:0:0:1]", "ws://[0:0:0:0:0:0:0:1]"),
            ("wss://[::ffff:192.0.2.1]:443", "wss://[::ffff:192.0.2.1]:443"),
            ("wss://[2001:DB8::1]", "wss://[2001:db8::1]"),
            ("wss://relay.example.com:65535", "wss://relay.example.com:65535"),
        ]
        for (input, normalized) in ok {
            #expect(try RelayURL.parse(input).url == normalized, "\(input)")
        }
        #expect(try RelayURL.parse("wss://relay.example.com/").connectURL == "wss://relay.example.com/v1/connect")
        let bad: [(String, RelayURLError)] = [
            ("https://relay.example.com", .badScheme),
            ("WSS://relay.example.com", .badScheme),
            ("ws://relay.example.com", .insecureRemote),
            ("ws://10.0.0.1", .insecureRemote),
            ("ws://localhost.evil.com", .insecureRemote),
            ("ws://[::2]", .insecureRemote),
            ("wss://user@relay.example.com", .badCharacter),
            ("wss://relay.example.com/?a=b", .badCharacter),
            ("wss://relay.example.com/#x", .badCharacter),
            ("wss://relay example.com", .badCharacter),
            ("wss://reläy.example.com", .badCharacter),
            ("wss://", .badHost),
            ("wss://relay..example.com", .badHost),
            ("wss://-relay.example.com", .badHost),
            ("wss://relay_x.example.com", .badHost),
            ("wss://[::1", .badHost),
            ("wss://[zz::1]", .badHost),
            ("wss://relay.example.com:", .badPort),
            ("wss://relay.example.com:0", .badPort),
            ("wss://relay.example.com:65536", .badPort),
            ("wss://relay.example.com:+80", .badPort),
            ("wss://relay.example.com:80:80", .badPort),
            ("wss://[::1]8080", .badPort),
            ("wss://relay.example.com//x", .badPath),
            ("wss://relay.example.com/../x", .badPath),
            ("wss://relay.example.com/a%20b", .badPath),
            // Swift-side extras, following Rust's `Ipv4Addr` / `Ipv6Addr` parsers.
            ("ws://127.0.0.01", .insecureRemote),  // leading zero: not an IPv4, not loopback
            ("ws://[::ffff:127.0.0.1]", .insecureRemote),  // mapped, not `::1`
            ("wss://[1::2::3]", .badHost),
            ("wss://[::1%25en0]", .badHost),
            ("wss://[1:2:3:4:5:6:7:8:9]", .badHost),
            ("wss://[12345::1]", .badHost),
        ]
        for (input, expected) in bad {
            #expect(thrown { () throws(RelayURLError) in try RelayURL.parse(input) } == expected, "\(input)")
        }
        let long = "wss://" + String(repeating: "a", count: RelayURL.maxLength) + ".com"
        #expect(thrown { () throws(RelayURLError) in try RelayURL.parse(long) } == .tooLong)
    }

    /// Spot checks of the ported `core::net::parser` accept set.
    @Test func ipLiteralParsersMatchRust() {
        func v4(_ s: String) -> [UInt8]? { IPAddress.parseIPv4(Array(s.utf8)) }
        func v6(_ s: String) -> [UInt16]? { IPAddress.parseIPv6(Array(s.utf8)) }
        #expect(v4("127.0.0.1") == [127, 0, 0, 1])
        #expect(v4("0.0.0.0") == [0, 0, 0, 0])
        #expect(v4("255.255.255.255") == [255, 255, 255, 255])
        for bad in ["256.0.0.1", "1.2.3", "1.2.3.4.5", "01.2.3.4", "1.2.3.4 ", "", "1..2.3", "1.2.3.0004"] {
            #expect(v4(bad) == nil, "\(bad)")
        }
        #expect(v6("::") == [0, 0, 0, 0, 0, 0, 0, 0])
        #expect(v6("::1") == [0, 0, 0, 0, 0, 0, 0, 1])
        #expect(v6("1::") == [1, 0, 0, 0, 0, 0, 0, 0])
        #expect(v6("1:2:3:4:5:6:7:8") == [1, 2, 3, 4, 5, 6, 7, 8])
        #expect(v6("1:2:3:4:5:6:1.2.3.4") == [1, 2, 3, 4, 5, 6, 0x0102, 0x0304])
        #expect(v6("::1.2.3.4") == [0, 0, 0, 0, 0, 0, 0x0102, 0x0304])
        #expect(v6("0001::00ff") == [1, 0, 0, 0, 0, 0, 0, 0xff])
        for bad in [":::", "1:2:3:4:5:6:7:8:9", "1::2::3", "1.2.3.4::", "::12345", ":1::", "1:2:3:4:5:6:7:1.2.3.4", "g::"] {
            #expect(v6(bad) == nil, "\(bad)")
        }
    }
}
