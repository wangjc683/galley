import Foundation
import Testing

@testable import GalleyRemote

/// One P0 method, seen generically: its Swift type names and a decode →
/// encode round trip of its request and response.
private struct MethodEntry {
    let name: String
    let paramsType: String
    let resultType: String
    let reencodeRequest: (Request) throws -> Envelope
    let reencodeResponse: (Response) throws -> Envelope
}

private func entry<M: RemoteMethod>(_ method: M.Type) -> MethodEntry {
    MethodEntry(
        name: M.name, paramsType: String(describing: M.Params.self), resultType: String(describing: M.Result.self),
        reencodeRequest: { request in
            .request(Request(id: request.id, M.self, params: try request.params(M.self)))
        },
        reencodeResponse: { response in
            guard case .success(let result) = try response.result(M.self) else {
                throw FixtureError("\(M.name) response is an error")
            }
            return .response(.ok(id: response.id, M.self, result: result))
        })
}

@Suite struct AppTests {
    // MARK: Golden (also the drift check of design §10)

    /// Every sample in `app-messages.json` decodes into the Swift type the
    /// fixture names and encodes back to the same JSON (compared as
    /// values; key order is not significant). A field, enum value, method
    /// or event the Swift side does not know makes this fail: the field
    /// is dropped on re-encode, the value becomes `unknown`, the name has
    /// no Swift entry.
    @Test func goldenSamplesRoundTripThroughSwiftTypes() throws {
        let doc = try Fixtures.golden(
            "app-messages.json",
            keys: ["fixture", "description", "protocol", "methods", "events", "samples", "chunked", "limits"])
        try expectKeys(doc["protocol"], ["major", "minor"], "protocol")
        #expect(try #require(doc["protocol"]).decode(ProtocolVersion.self) == .current)
        #expect(try array(doc["methods"]).map(string) == Methods.names)
        #expect(try array(doc["events"]).map(string) == AppEvent.names)

        let entries = Dictionary(uniqueKeysWithValues: Methods.all.map { entry($0) }.map { ($0.name, $0) })
        var requested = [String]()
        var answered = [String]()
        var evented = [String]()
        for sample in try array(doc["samples"]) {
            let name = try string(sample["name"])
            let kind = try string(sample["kind"])
            let type = try string(sample["type"])
            let message = try #require(sample["message"])
            let envelope = try Envelope.fromJSON(message.jsonData())
            let reencoded: Envelope
            switch (kind, envelope) {
            case ("request", .request(let request)):
                try expectKeys(sample, ["name", "kind", "method", "type", "message"], name)
                let method = try string(sample["method"])
                #expect(request.method == method)
                let known = try #require(entries[method], "method \(method) has no Swift type")
                #expect(known.paramsType == type, "\(name)")
                reencoded = try known.reencodeRequest(request)
                // The enum path decodes it too.
                let typed = try ClientRequest(request: request)
                #expect(typed.method == method)
                #expect(Envelope.request(typed.toRequest(id: request.id)) == reencoded)
                requested.append(method)
            case ("response", .response(let response)):
                try expectKeys(sample, ["name", "kind", "method", "type", "message"], name)
                let method = try string(sample["method"])
                let known = try #require(entries[method], "method \(method) has no Swift type")
                #expect(known.resultType == type, "\(name)")
                reencoded = try known.reencodeResponse(response)
                answered.append(method)
            case ("error", .response(let response)):
                try expectKeys(sample, ["name", "kind", "method", "type", "message"], name)
                #expect(type == String(describing: ErrorBody.self))
                guard case .failure(let error) = response.outcome else {
                    Issue.record("\(name) is not an error")
                    continue
                }
                reencoded = .response(.error(id: response.id, error))
            case ("event", .event(let event)):
                try expectKeys(sample, ["name", "kind", "event", "type", "message"], name)
                #expect(event.name == (try string(sample["event"])))
                let typed = try #require(try AppEvent(event: event), "event \(event.name) has no Swift type")
                #expect(typed.name == event.name)
                #expect(String(describing: Swift.type(of: typed.payload)) == type, "\(name)")
                reencoded = .event(typed.toEvent())
                evented.append(event.name)
            default:
                Issue.record("\(name): sample kind \(kind) the Swift side does not know, or a mismatched envelope")
                continue
            }
            #expect(try JSONValue(parsing: reencoded.toJSON()) == message, "\(name) re-encodes to the fixture")
        }
        #expect(requested == Methods.names, "a request sample per method")
        #expect(answered == Methods.names, "a response sample per method")
        #expect(evented == AppEvent.names, "a sample per event")
    }

    @Test func goldenChunkedMessage() throws {
        let doc = try Fixtures.load(Fixtures.goldenDirectory.appending(path: "app-messages.json"))
        let chunked = doc["chunked"]
        try expectKeys(chunked, ["description", "chunkSize", "chunks", "reassembled"], "chunked")
        let chunks = try array(chunked?["chunks"])
        let reassembledJSON = try #require(chunked?["reassembled"])

        var reassembler = Reassembler()
        var joined = Data()
        var result: Envelope?
        for (index, chunk) in chunks.enumerated() {
            let envelope = try Envelope.fromJSON(chunk.jsonData())
            guard case .chunk(let piece) = envelope else {
                Issue.record("chunk \(index) is not a chunk")
                return
            }
            joined.append(piece.data)
            result = try reassembler.push(envelope)
            #expect((result == nil) == (index < chunks.count - 1))
        }
        #expect(try JSONValue(parsing: joined) == reassembledJSON, "joined data is the message")
        let expected = try Envelope.fromJSON(reassembledJSON.jsonData())
        #expect(result == expected)
        #expect(reassembler.buffered == 0)

        // Swift's chunker cuts the same bytes into the same chunks.
        var chunker = Chunker()
        let mine = chunker.split(joined, chunkSize: try int(chunked?["chunkSize"]))
        #expect(try mine.map { try JSONValue(parsing: $0) } == chunks)

        // And the message is the typed attachment.read response.
        guard case .response(let response) = try #require(result) else {
            Issue.record("not a response")
            return
        }
        let read = try response.result(Methods.AttachmentRead.self).get()
        #expect(read.attachmentId == "att_02" && read.byteSize == 96 && read.data.count == 128)
    }

    @Test func goldenLimits() throws {
        let doc = try Fixtures.load(Fixtures.goldenDirectory.appending(path: "app-messages.json"))
        let limits = doc["limits"]
        try expectKeys(
            limits,
            ["maxAppRecordLen", "chunkDataMax", "maxMessageLen", "maxStreams", "messagesPageDefault", "messagesPageMax"],
            "limits")
        #expect(try int(limits?["maxAppRecordLen"]) == NoiseSession.maxAppRecordLength)
        #expect(try int(limits?["chunkDataMax"]) == Chunking.dataMax)
        #expect(try int(limits?["maxMessageLen"]) == Chunking.maxMessageLength)
        #expect(try int(limits?["maxStreams"]) == Chunking.maxStreams)
        #expect(try int(limits?["messagesPageDefault"]) == Int(MessagesPage.defaultLimit))
        #expect(try int(limits?["messagesPageMax"]) == Int(MessagesPage.maxLimit))
    }

    /// The Rust crate's golden directory holds exactly the files mirrored
    /// here; a new fixture file fails until the Swift side reads it.
    @Test func goldenDirectoryHoldsTheKnownFiles() throws {
        let names = try FileManager.default.contentsOfDirectory(atPath: Fixtures.goldenDirectory.path)
            .filter { !$0.hasPrefix(".") }
        #expect(Set(names) == Set(Fixtures.goldenFiles.keys))
    }

    // MARK: Mirrors of the Rust unit tests (`src/app/mod.rs`)

    func roundTrip(_ text: String) throws -> Envelope {
        let envelope = try Envelope.fromJSON(Data(text.utf8))
        #expect(try Envelope.fromJSON(envelope.toJSON()) == envelope)
        return envelope
    }

    @Test func envelopeShapesMatchTheDesign() {
        let request = Envelope.request(Request(id: 7, Methods.SessionStop.self, params: SessionIdParams(sessionId: "s1")))
        #expect(String(decoding: request.toJSON(), as: UTF8.self) == #"{"t":"req","id":7,"m":"session.stop","p":{"sessionId":"s1"}}"#)
        let response = Envelope.response(.error(id: 7, ErrorBody(code: ErrorCode.historyReplay, message: "...")))
        #expect(
            String(decoding: response.toJSON(), as: UTF8.self)
                == #"{"t":"res","id":7,"ok":false,"e":{"code":"history_replay","message":"..."}}"#)
        let chunk = Envelope.chunk(Chunk(id: 7, index: 0, last: false, data: Data("hi".utf8)))
        #expect(String(decoding: chunk.toJSON(), as: UTF8.self) == #"{"t":"chunk","id":7,"i":0,"last":false,"data":"aGk="}"#)
    }

    @Test func decodingIgnoresUnknownFieldsAndDefaultsP() throws {
        let envelope = try roundTrip(#"{"t":"req","id":1,"m":"sessions.list","future":true}"#)
        guard case .request(let request) = envelope else {
            Issue.record("not a request")
            return
        }
        #expect(request.params == .object([:]))
        #expect(try request.params(Methods.SessionsList.self) == Empty())
        _ = try roundTrip(#"{"t":"evt","n":"x.y","p":{"a":1},"extra":[1]}"#)
        _ = try roundTrip(#"{"t":"res","id":2,"ok":true,"r":{},"n":"ignored"}"#)
        // Rust's `Option<Value>` reads `null` as absent.
        #expect(try Envelope.fromJSON(Data(#"{"t":"req","id":1,"m":"x","p":null}"#.utf8)) == .request(Request(id: 1, method: "x", params: .object([:]))))
    }

    @Test func decodingIsStrictAboutRequiredFields() {
        let cases: [(String, String)] = [
            ("not json", "json"),
            (#"{"id":1}"#, "json"),
            (#"{"t":"push"}"#, "unknown"),
            (#"{"t":"req","m":"hello"}"#, "missing"),
            (#"{"t":"req","id":1}"#, "missing"),
            (#"{"t":"req","id":-1,"m":"hello"}"#, "json"),
            (#"{"t":"res","id":1,"r":{}}"#, "missing"),
            (#"{"t":"res","id":1,"ok":true}"#, "missing"),
            (#"{"t":"res","id":1,"ok":false,"r":{}}"#, "missing"),
            (#"{"t":"res","id":1,"ok":true,"r":{},"e":{"code":"x"}}"#, "inconsistent"),
            (#"{"t":"evt","p":{}}"#, "missing"),
            (#"{"t":"chunk","id":1,"i":0,"last":true}"#, "missing"),
            (#"{"t":"chunk","id":1,"i":0,"last":true,"data":"@@"}"#, "chunk"),
            // Swift-side extras, checked against the Rust crate.
            (#"{"t":"res","id":1,"ok":true,"r":null}"#, "missing"),
            (#"{"t":"res","id":1,"ok":false,"e":{"message":"m"}}"#, "json"),
            (#"{"t":"chunk","id":1,"i":0,"last":true,"data":"aGk"}"#, "chunk"),
            (#"{"t":"req","id":"1","m":"hello"}"#, "json"),
            ("[]", "json"),
        ]
        for (text, kind) in cases {
            let error = thrown { () throws(AppError) in try Envelope.fromJSON(Data(text.utf8)) }
            let matches: Bool
            switch (kind, error) {
            case ("json", .json?), ("unknown", .unknownType?), ("missing", .missingField?),
                ("inconsistent", .inconsistent?), ("chunk", .badChunk?):
                matches = true
            default:
                matches = false
            }
            #expect(matches, "\(text): \(String(describing: error))")
        }
    }

    @Test func errorBodyMessageDefaultsOnlyWhenAbsent() throws {
        let absent = try Envelope.fromJSON(Data(#"{"t":"res","id":1,"ok":false,"e":{"code":"x"}}"#.utf8))
        #expect(absent == .response(.error(id: 1, ErrorBody(code: "x", message: ""))))
        let null = thrown { () throws(AppError) in
            try Envelope.fromJSON(Data(#"{"t":"res","id":1,"ok":false,"e":{"code":"x","message":null}}"#.utf8))
        }
        guard case .json = null else {
            Issue.record("null message accepted")
            return
        }
    }

    @Test func unknownAndMismatchedMethods() {
        let request = Request(id: 3, method: "session.fly", params: .object([:]))
        #expect(thrown { () throws(ErrorBody) in try ClientRequest(request: request) }?.code == ErrorCode.unknownMethod)
        #expect(
            thrown { () throws(ErrorBody) in try ClientRequest(request: request) }?.message == #"unknown method "session.fly""#)
        #expect(thrown { () throws(ErrorBody) in try request.params(Methods.Hello.self) }?.code == ErrorCode.unknownMethod)
        let bad = Request(id: 4, method: "session.stop", params: json(#"{"sessionId":5}"#))
        #expect(thrown { () throws(ErrorBody) in try ClientRequest(request: bad) }?.code == ErrorCode.invalidParams)
    }

    @Test func typedResults() throws {
        let response = Response.ok(id: 9, Methods.SessionStop.self, result: SessionStopResult(dispatch: .alreadyStopped))
        #expect(try response.result(Methods.SessionStop.self).get().dispatch == .alreadyStopped)
        let wrong = Response(id: 9, outcome: .success(json(#"{"dispatch":1}"#)))
        guard case .json = thrown({ () throws(AppError) in try wrong.result(Methods.SessionStop.self) }) else {
            Issue.record("a result of the wrong shape decoded")
            return
        }
        let failed = Response.error(id: 9, ErrorBody(code: ErrorCode.notFound, message: "gone"))
        guard case .failure(let error) = try failed.result(Methods.SessionStop.self) else {
            Issue.record("an error decoded as a result")
            return
        }
        #expect(error.code == "not_found")
    }

    @Test func versions() {
        #expect(ProtocolVersion.current.isCompatible(with: ProtocolVersion(major: 1, minor: 9)))
        #expect(!ProtocolVersion.current.isCompatible(with: ProtocolVersion(major: 2, minor: 0)))
    }

    // MARK: Mirrors of `src/app/methods.rs`

    @Test func everyMethodRoundTripsThroughARequest() throws {
        let requests: [ClientRequest] = [
            .hello(HelloParams(appVersion: "1.0")),
            .sessionsList(Empty()),
            .sessionMessages(SessionMessagesParams(sessionId: "s", before: nil, limit: 20)),
            .sessionSend(SessionSendParams(sessionId: "s", text: "hi", clientRequestId: nil)),
            .sessionStop(SessionIdParams(sessionId: "s")),
            .sessionCreate(SessionCreateParams()),
            .sessionMarkRead(SessionIdParams(sessionId: "s")),
            .sessionSubscribe(SessionIdParams(sessionId: "s")),
            .sessionUnsubscribe(SessionIdParams(sessionId: "s")),
            .attachmentRead(AttachmentReadParams(sessionId: "s", attachmentId: "a")),
            .deviceRegisterPush(RegisterPushParams(token: "ab", env: .sandbox)),
        ]
        #expect(requests.map(\.method) == Methods.names)
        for (index, request) in requests.enumerated() {
            let wire = request.toRequest(id: UInt64(index))
            let back = try Envelope.fromJSON(Envelope.request(wire).toJSON())
            guard case .request(let decoded) = back else {
                Issue.record("not a request")
                continue
            }
            #expect(try ClientRequest(request: decoded) == request)
        }
    }

    @Test func optionalParamsMayBeAbsentAndUnknownOnesAreIgnored() throws {
        let request = Request(id: 1, method: "session.send", params: json(#"{"sessionId":"s","text":"t","future":1}"#))
        guard case .sessionSend(let params) = try ClientRequest(request: request) else {
            Issue.record("wrong case")
            return
        }
        #expect(params.images.isEmpty)
        #expect(params.clientRequestId == nil)
        // `#[serde(default)]` covers an absent field, not `null`.
        let null = Request(id: 1, method: "session.send", params: json(#"{"sessionId":"s","text":"t","images":null}"#))
        #expect(thrown { () throws(ErrorBody) in try ClientRequest(request: null) }?.code == ErrorCode.invalidParams)
    }

    @Test func explicitNullsOnTheWire() throws {
        #expect(try JSONValue(encoding: SessionMessagesParams(sessionId: "s")) == json(#"{"sessionId":"s","before":null,"limit":null}"#))
        #expect(try JSONValue(encoding: SessionCreateParams()) == json(#"{"projectId":null,"title":null}"#))
        #expect(
            try JSONValue(encoding: SessionSendParams(sessionId: "s", text: "t", clientRequestId: nil))
                == json(#"{"sessionId":"s","text":"t","images":[],"clientRequestId":null}"#))
    }

    @Test func unknownEnumValuesDecodeAsUnknown() throws {
        #expect(try json(#"{"dispatch":"teleported"}"#).decode(SessionStopResult.self).dispatch == .unknown)
        #expect(try json(#""flying""#).decode(SessionStatus.self) == .unknown)
        #expect(try json(#""waiting_approval""#).decode(SessionStatus.self) == .waitingApproval)
        #expect(try json(#""robot""#).decode(OriginVia.self) == .unknown)
        #expect(try json(#""tool""#).decode(MessageRole.self) == .unknown)
        #expect(try json(#""later""#).decode(SendOutcome.self) == .unknown)
        #expect(try json(#""side_question""#).decode(SendOutcome.self) == .sideQuestion)
        #expect(try json(#""lost""#).decode(Dispatch.self) == .unknown)
        #expect(try json(#""paused""#).decode(ReplayPhase.self) == .unknown)
        // `PushEnv` is a closed set, as in Rust.
        #expect(throws: (any Error).self) { try json(#""staging""#).decode(PushEnv.self) }
        // Unknown encodes as "unknown".
        #expect(try JSONValue(encoding: SessionStatus.unknown) == .string("unknown"))
    }

    // MARK: Mirrors of `src/app/events.rs`

    @Test func unknownEventsAreIgnoredAndBadPayloadsAreErrors() throws {
        #expect(try AppEvent(event: Event(name: "session.teleported", payload: .object([:]))) == nil)
        guard case .json = thrown({ () throws(AppError) in
            try AppEvent(event: Event(name: "history.replay", payload: json(#"{"sessionId":1}"#)))
        }) else {
            Issue.record("a bad payload decoded")
            return
        }
    }

    @Test func eventRoundTripAndNames() throws {
        let event = AppEvent.syncRequired(SyncRequiredEvent(sessionId: nil))
        let wire = event.toEvent()
        #expect(wire.name == "sync.required")
        #expect(wire.payload == json(#"{"sessionId":null}"#))
        #expect(try AppEvent(event: wire) == event)
        #expect(Set(AppEvent.names).count == AppEvent.names.count)
    }

    @Test func goalPayloadIsRequiredButMayBeNull() throws {
        let null = try AppEvent(event: Event(name: "goal.updated", payload: json(#"{"goal":null}"#)))
        #expect(null == .goalUpdated(GoalUpdatedEvent(goal: .null)))
        #expect(thrown { () throws(AppError) in try AppEvent(event: Event(name: "goal.updated", payload: .object([:]))) } != nil)
    }

    // MARK: Mirrors of `src/app/chunk.rs`

    func bigResponse(_ bytes: Int) -> Envelope {
        .response(
            .ok(
                id: 5, Methods.AttachmentRead.self,
                result: AttachmentReadResult(
                    attachmentId: "a", mimeType: "image/png", byteSize: UInt64(bytes),
                    data: String(repeating: "A", count: bytes))))
    }

    func feed(_ reassembler: inout Reassembler, _ bodies: [Data]) throws -> [Envelope] {
        try bodies.compactMap { try reassembler.push(Envelope.fromJSON($0)) }
    }

    @Test func smallMessagesAreNotChunked() throws {
        let envelope = bigResponse(10)
        var chunker = Chunker()
        #expect(try chunker.encode(envelope) == [envelope.toJSON()])
    }

    @Test func largeMessagesChunkAndReassemble() throws {
        let envelope = bigResponse(200_000)
        var chunker = Chunker()
        let bodies = try chunker.encode(envelope)
        #expect(bodies.count > 4)
        #expect(bodies.allSatisfy { $0.count <= NoiseSession.maxAppRecordLength })
        var reassembler = Reassembler()
        #expect(try feed(&reassembler, bodies) == [envelope])
        #expect(reassembler.buffered == 0)
    }

    @Test func worstCaseChunkFitsOneRecord() {
        let body = Envelope.chunk(Chunk(id: UInt64.max, index: UInt32.max, last: false, data: Data(repeating: 0xff, count: Chunking.dataMax))).toJSON()
        #expect(body.count <= NoiseSession.maxAppRecordLength, "\(body.count)")
    }

    @Test func interleavedStreamsAndPlainMessages() throws {
        let a = bigResponse(300)
        let b = bigResponse(500)
        var chunker = Chunker()
        let ca = chunker.split(a.toJSON(), chunkSize: 100)
        let cb = chunker.split(b.toJSON(), chunkSize: 100)
        let plain = Envelope.event(Event(name: "x", payload: .object([:])))
        var bodies = [Data]()
        for i in 0..<max(ca.count, cb.count) {
            if i < ca.count { bodies.append(ca[i]) }
            if i == 1 { bodies.append(plain.toJSON()) }
            if i < cb.count { bodies.append(cb[i]) }
        }
        var reassembler = Reassembler()
        #expect(try feed(&reassembler, bodies) == [plain, a, b])
    }

    func chunk(_ id: UInt64, _ index: UInt32, _ last: Bool, _ data: Data) -> Envelope {
        .chunk(Chunk(id: id, index: index, last: last, data: data))
    }

    @Test func badStreamsAreRejected() throws {
        var r = Reassembler()
        func error(_ envelope: Envelope) -> AppError? {
            thrown { () throws(AppError) in try r.push(envelope) }
        }
        #expect(error(chunk(1, 1, false, Data("x".utf8))) == .badChunk("stream must start at 0"))
        #expect(try r.push(chunk(1, 0, false, Data("x".utf8))) == nil)
        #expect(error(chunk(1, 2, false, Data("x".utf8))) == .badChunk("chunk out of order"))
        #expect(r.buffered == 0, "out-of-order drops the stream")
        #expect(error(chunk(2, 0, false, Data())) == .badChunk("chunk data size"))
        #expect(error(chunk(2, 0, false, Data(count: Chunking.dataMax + 1))) == .badChunk("chunk data size"))
        // A stream that ends in something that is not a message.
        #expect(try r.push(chunk(3, 0, false, Data(#"{"t":"#.utf8))) == nil)
        guard case .json = error(chunk(3, 1, true, Data("1}".utf8))) else {
            Issue.record("a broken message reassembled")
            return
        }
        // A chunk wrapping a chunk.
        let inner = chunk(9, 0, true, Data("x".utf8)).toJSON()
        #expect(error(chunk(4, 0, true, inner)) == .badChunk("a chunk inside a chunk"))
        // Chunking a chunk is refused on the sending side too.
        var chunker = Chunker()
        #expect(thrown { () throws(AppError) in try chunker.encode(chunk(1, 0, true, Data("x".utf8))) } == .badChunk("a chunk cannot be chunked"))
    }

    @Test func limitsAreEnforcedOnAnOversizeStream() throws {
        var r = Reassembler(maxMessageLength: 10, maxStreams: 2)
        #expect(try r.push(chunk(1, 0, false, Data("12345".utf8))) == nil)
        #expect(try r.push(chunk(2, 0, false, Data("1234".utf8))) == nil)
        #expect(thrown { () throws(AppError) in try r.push(chunk(3, 0, false, Data("1".utf8))) } == .tooManyStreams(limit: 2))
        #expect(thrown { () throws(AppError) in try r.push(chunk(2, 1, false, Data("12".utf8))) } == .tooLarge(limit: 10))
        #expect(r.buffered == 5, "only the oversize stream was dropped")
        r.clear()
        #expect(r.buffered == 0)
        let huge = Envelope.event(Event(name: "x", payload: .string(String(repeating: "a", count: Chunking.maxMessageLength))))
        var chunker = Chunker()
        #expect(thrown { () throws(AppError) in try chunker.encode(huge) } == .tooLarge(limit: Chunking.maxMessageLength))
    }
}
