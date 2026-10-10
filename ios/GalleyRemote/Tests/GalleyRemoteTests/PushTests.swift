import CryptoKit
import Foundation
import Testing

@testable import GalleyRemote

@Suite struct PushTests {
    // MARK: Golden

    /// `push.json`: Swift rebuilds the content JSON, the padded plaintext,
    /// the sealed bytes (same fixed nonce), `g` and the APNs payload
    /// byte for byte, and opens the fixture's `g`.
    @Test func goldenPushMatchesRustByteForByte() throws {
        let doc = try Fixtures.golden(
            "push.json",
            keys: [
                "fixture", "description", "pushKey", "pushKeySource", "aadText", "nonce", "content",
                "contentJsonText", "paddedLen", "paddedPlaintext", "sealedLen", "g", "apnsPayloadText",
                "apnsPayloadLen",
            ])
        let key = fixtureMasterKey().derive().pushKey
        #expect(try hex(doc["pushKey"]) == key.exposeSecret())
        #expect(try string(doc["pushKeySource"]) == "keys.json pushKey")
        #expect(Data(try string(doc["aadText"]).utf8) == Push.aad)
        #expect(try int(doc["paddedLen"]) == Push.paddedLength)
        #expect(try int(doc["sealedLen"]) == Push.sealedLength)

        try expectKeys(doc["content"], ["seq", "sessionId", "kind", "title", "body"], "content")
        let fixtureContent = try #require(doc["content"]).decode(PushContent.self)
        // Built the way Core builds it, the content is the fixture's.
        let content = try PushContent(
            seq: fixtureContent.seq, sessionId: fixtureContent.sessionId, kind: fixtureContent.kind,
            title: fixtureContent.title, body: fixtureContent.body)
        #expect(content == fixtureContent)
        #expect(content.kind == Push.Kind.askUser)
        #expect(String(decoding: content.jsonBytes(), as: UTF8.self) == (try string(doc["contentJsonText"])))
        #expect(try content.paddedPlaintext() == (try hex(doc["paddedPlaintext"])))

        let sealed = try Push.sealWithNonceForTestingOnly(key: key, content: content, nonce: hex(doc["nonce"]))
        #expect(sealed.count == Push.sealedLength)
        #expect(Push.encodeG(sealed) == (try string(doc["g"])))
        let payload = try Push.apnsPayload(sealed: sealed)
        #expect(payload == (try string(doc["apnsPayloadText"])))
        #expect(payload.utf8.count == (try int(doc["apnsPayloadLen"])))
        #expect(try Push.openG(key: key, g: string(doc["g"])) == content)

        // The APNs JSON parses, and `g` is where the extension looks.
        let apns = json(payload)
        #expect(apns["g"]?.stringValue == (try string(doc["g"])))
        #expect(apns["aps"]?["mutable-content"] == .int(1))
    }

    // MARK: Mirrors of the Rust unit tests (`src/push.rs`)

    func key(_ seed: UInt8) -> PushKey {
        try! MasterKey(bytes: Data(repeating: seed, count: 32)).derive().pushKey
    }

    @Test func sealOpenRoundTrip() throws {
        let content = try PushContent(seq: 42, sessionId: "ses_abc", kind: Push.Kind.askUser, title: "标题", body: "在问你：继续吗？")
        let sealed = try Push.seal(key: key(1), content: content)
        #expect(sealed.count == Push.sealedLength)
        #expect(try Push.open(key: key(1), sealed: sealed) == content)
        #expect(try Push.openG(key: key(1), g: Push.encodeG(sealed)) == content)
        let other = try Push.seal(key: key(1), content: content)
        #expect(sealed.prefix(Push.nonceLength) != other.prefix(Push.nonceLength), "fresh nonce per push")
    }

    @Test func openRejectsWrongKeyTamperingAndBadInput() throws {
        let content = try PushContent(seq: 1, sessionId: nil, kind: Push.Kind.goal, title: "t", body: "b")
        let sealed = try Push.seal(key: key(1), content: content)
        #expect(thrown { () throws(PushError) in try Push.open(key: key(2), sealed: sealed) } == .decrypt)
        for i in [0, Push.nonceLength, Push.sealedLength - 1] {
            var bad = sealed
            bad[i] ^= 1
            #expect(thrown { () throws(PushError) in try Push.open(key: key(1), sealed: bad) } == .decrypt, "byte \(i)")
        }
        #expect(
            thrown { () throws(PushError) in try Push.open(key: key(1), sealed: sealed.dropFirst()) }
                == .badLength(expected: Push.sealedLength, actual: Push.sealedLength - 1))
        #expect(thrown { () throws(PushError) in try Push.openG(key: key(1), g: "not base64!") } == .badBase64)
        // 2076 bytes encode without padding, so any `=` is non-canonical.
        let g = Push.encodeG(sealed)
        #expect(!g.hasSuffix("="))
        #expect(thrown { () throws(PushError) in try Push.openG(key: key(1), g: g + "=") } == .badBase64)
        #expect(
            thrown { () throws(PushError) in try Push.openG(key: key(1), g: "-" + g.dropFirst()) } == .badBase64,
            "url-safe alphabet")
        #expect(
            thrown { () throws(PushError) in try Push.openG(key: key(1), g: String(g.dropLast(4))) }
                == .badLength(expected: Push.sealedLength, actual: Push.sealedLength - 3))
    }

    @Test func aadBindsTheVersion() throws {
        let content = try PushContent(seq: 1, sessionId: nil, kind: Push.Kind.goal, title: "t", body: "b")
        let plaintext = try content.paddedPlaintext()
        let box = try ChaChaPoly.seal(
            plaintext, using: key(1).symmetricKey, nonce: ChaChaPoly.Nonce(data: Data(repeating: 7, count: 12)),
            authenticating: Data("galley-push/2".utf8))
        #expect(thrown { () throws(PushError) in try Push.open(key: key(1), sealed: box.combined) } == .decrypt)
    }

    @Test func badPaddingAndJSONInsideAValidSeal() throws {
        func seal(_ plaintext: Data) throws -> Data {
            try ChaChaPoly.seal(plaintext, using: key(1).symmetricKey, authenticating: Push.aad).combined
        }
        var nonzero = try PushContent(seq: 1, sessionId: nil, kind: "goal", title: "", body: "").paddedPlaintext()
        nonzero[Push.paddedLength - 1] = 1
        let sealedNonzero = try seal(nonzero)
        #expect(thrown { () throws(PushError) in try Push.open(key: key(1), sealed: sealedNonzero) } == .padding(.nonZeroPadding))
        let notJSON = try seal(Padding.pad(Data("{".utf8), to: Push.paddedLength))
        guard case .json = thrown({ () throws(PushError) in try Push.open(key: key(1), sealed: notJSON) }) else {
            Issue.record("bad JSON opened")
            return
        }
        // Unknown fields are ignored; an absent sessionId is nil.
        let extra = try Padding.pad(Data(#"{"seq":5,"kind":"goal","title":"t","body":"b","new":1}"#.utf8), to: Push.paddedLength)
        let opened = try Push.open(key: key(1), sealed: seal(extra))
        #expect(opened == PushContent(unchecked: 5, sessionId: nil, kind: "goal", title: "t", body: "b"))
    }

    @Test func fieldsAreValidated() {
        for id in ["", "a\"b", "a\\b", "a b", "é", String(repeating: "x", count: 129)] {
            #expect(
                thrown { () throws(PushError) in try PushContent(seq: 1, sessionId: id, kind: Push.Kind.goal, title: "", body: "") }
                    == .badField("sessionId"), "\(id)")
        }
        for k in ["", "Goal", "goal-x", String(repeating: "k", count: 33)] {
            #expect(
                thrown { () throws(PushError) in try PushContent(seq: 1, sessionId: nil, kind: k, title: "", body: "") }
                    == .badField("kind"), "\(k)")
        }
    }

    @Test func truncationIsScalarSafeAndEscapeAware() {
        #expect(Push.truncateForJSON("short", max: 10) == "short")
        #expect(Push.truncateForJSON("abcdefghij", max: 10) == "abcdefghij")
        #expect(Push.truncateForJSON("abcdefghijk", max: 10) == "abcdefg…")
        // 3-byte characters: 10 - 3 = 7 bytes of budget holds two of them.
        #expect(Push.truncateForJSON("一二三四", max: 10) == "一二…")
        // A quote costs 2 escaped bytes, a control character 6.
        #expect(Push.truncateForJSON("\"\"\"\"\"\"", max: 10) == "\"\"\"…")
        #expect(Push.truncateForJSON("\u{1}\u{1}", max: 10) == "\u{1}…")
        // Rust cuts on `char` (scalar) boundaries, inside a grapheme too.
        #expect(Push.truncateForJSON("e\u{301}e\u{301}e\u{301}e\u{301}", max: 8) == "e\u{301}e…")
        for s in [
            String(repeating: "😀", count: 500), String(repeating: "\u{1}", count: 500),
            String(repeating: "\"", count: 900), String(repeating: "a", count: 5000),
        ] {
            let cut = Push.truncateForJSON(s, max: Push.bodyMaxJSONBytes)
            #expect(Push.jsonEscapedLength(of: cut) <= Push.bodyMaxJSONBytes)
            #expect(cut.hasSuffix("…"))
            var written = ""
            JSONWriter.writeString(cut, into: &written)
            #expect(written.utf8.count == Push.jsonEscapedLength(of: cut) + 2, "escape model matches the writer")
        }
    }

    @Test func writerEscapesLikeSerdeJSON() {
        var out = ""
        JSONWriter.writeString("\"\\/\u{8}\u{c}\n\r\t\u{0}\u{1f}\u{7f}é😀", into: &out)
        #expect(out == #""\"\\/\b\f\n\r\t\u0000\u001f"# + "\u{7f}é😀\"")
    }

    @Test func worstCasePushFitsAPNs() throws {
        let sessionId = String(repeating: "z", count: Push.sessionIDMaxBytes)
        let kind = String(repeating: "k", count: Push.kindMaxBytes)
        for filler in ["\u{1}", "\"", "😀", "一", "a"] {
            let content = try PushContent(
                seq: UInt64.max, sessionId: sessionId, kind: kind, title: String(repeating: filler, count: 5000),
                body: String(repeating: filler, count: 50_000))
            #expect(content.jsonBytes().count <= Push.paddedLength - Padding.lengthPrefix, "\(filler)")
            let sealed = try Push.seal(key: key(1), content: content)
            #expect(try Push.apnsPayload(sealed: sealed).utf8.count <= Push.apnsMaxPayloadLength)
            #expect(try Push.open(key: key(1), sealed: sealed) == content, "u64::MAX seq survives JSONDecoder")
        }
    }

    @Test func largestFrameSealedPushStillFitsAPNs() throws {
        #expect(try Push.apnsPayload(sealed: Data(count: RelayProtocol.maxPushSealedLength)).utf8.count <= Push.apnsMaxPayloadLength)
        #expect(try Push.apnsPayload(sealed: Data(count: Push.sealedLength)).utf8.count == 2871)
        #expect(thrown { () throws(PushError) in try Push.apnsPayload(sealed: Data(count: RelayProtocol.maxPushSealedLength + 1)) } == .tooLarge)
    }

    @Test func handBuiltOversizedContentIsRefused() {
        let content = PushContent(
            unchecked: 1, sessionId: nil, kind: "goal", title: "", body: String(repeating: "a", count: Push.paddedLength))
        #expect(thrown { () throws(PushError) in try Push.seal(key: key(1), content: content) } == .tooLarge)
    }
}
