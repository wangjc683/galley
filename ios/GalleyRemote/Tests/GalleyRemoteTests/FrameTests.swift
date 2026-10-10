import Foundation
import Testing

@testable import GalleyRemote

@Suite struct FrameTests {
    // MARK: Golden

    /// The fixture's `fields` object, as Swift sees the frame.
    func fields(_ frame: Frame) -> JSONValue {
        switch frame {
        case .data(let peer, let payload):
            return .object(["peer": .int(Int64(peer.value)), "payload": .string(Hex.encode(payload))])
        case .peer(let peer, let role, let online):
            return .object([
                "peer": .int(Int64(peer.value)), "role": .string(role.headerValue), "online": .bool(online),
            ])
        case .push(let p):
            return .object([
                "requestId": .int(Int64(p.requestID)), "env": .string(p.env.rawValue),
                "priority": .int(Int64(p.priority.code)), "deviceToken": .string(Hex.encode(p.deviceToken)),
                "collapseId": p.collapseID.map { .string($0) } ?? .null, "sealed": .string(Hex.encode(p.sealed)),
            ])
        case .pushResult(let r):
            let status =
                switch r.status {
                case .ok: "ok"
                case .unregistered: "unregistered"
                case .failed: "failed"
                }
            return .object([
                "requestId": .int(Int64(r.requestID)), "status": .string(status),
                "apnsStatus": .int(Int64(r.apnsStatus)), "reason": .string(r.reason),
            ])
        case .ping(let nonce), .pong(let nonce):
            return .object(["nonce": nonce <= UInt64(Int64.max) ? .int(Int64(nonce)) : .uint(nonce)])
        }
    }

    @Test func goldenFramesDecodeAndReencodeByteForByte() throws {
        let doc = try Fixtures.golden(
            "frames.json", keys: ["fixture", "description", "relayProtocolVersion", "connect", "frames", "invalid"])
        #expect(try int(doc["relayProtocolVersion"]) == Int(RelayProtocol.version))
        try expectKeys(doc["connect"], ["path", "headers"], "connect")
        #expect(try string(doc["connect"]?["path"]) == RelayProtocol.connectPath)
        #expect(
            try array(doc["connect"]?["headers"]).map(string)
                == [RelayProtocol.headerChannel, RelayProtocol.headerRole, RelayProtocol.headerRelayVersion])

        let frames = try array(doc["frames"])
        #expect(Set(try frames.map { try string($0["type"]) }) == ["DATA", "PEER", "PUSH", "PUSH_RESULT", "PING", "PONG"])
        for item in frames {
            try expectKeys(item, ["name", "type", "fields", "hex"], "frame")
            let name = try string(item["name"])
            let bytes = try hex(item["hex"])
            let frame = try Frame.decode(bytes)
            #expect(frame.typeName == (try string(item["type"])), "\(name)")
            #expect(fields(frame) == item["fields"], "\(name): fields")
            #expect(try frame.encode() == bytes, "\(name): re-encode")
        }

        let invalid = try array(doc["invalid"])
        let labels: Set = ["empty", "unknown_type", "truncated", "trailing_bytes", "invalid_field"]
        for item in invalid {
            try expectKeys(item, ["why", "hex", "error"], "invalid frame")
            let why = try string(item["why"])
            let label = try string(item["error"])
            #expect(labels.contains(label), "label \(label) the Swift side does not have")
            let bytes = try hex(item["hex"])
            let error = try #require(thrown { () throws(FrameError) in try Frame.decode(bytes) }, "\(why) accepted")
            #expect(error.label == label, "\(why)")
        }
    }

    // MARK: Mirrors of the Rust unit tests (`src/frame.rs`)

    func push() -> PushRequest {
        PushRequest(
            requestID: 7, env: .sandbox, priority: .immediate, deviceToken: Data(repeating: 0xab, count: 32),
            collapseID: "c1", sealed: Data(repeating: 0x11, count: Push.sealedLength))
    }

    func allFrames() -> [Frame] {
        var noCollapse = push()
        noCollapse.collapseID = nil
        return [
            .data(peer: PeerID(3), payload: Data([1, 2, 3])),
            .data(peer: .host, payload: Data(count: RelayProtocol.maxDataPayload)),
            .peer(peer: .host, role: .host, online: false),
            .peer(peer: PeerID(9), role: .client, online: true),
            .push(push()),
            .push(noCollapse),
            .pushResult(PushResult(requestID: 7, status: .unregistered, apnsStatus: 410, reason: "Unregistered")),
            .pushResult(PushResult(requestID: 8, status: .failed, apnsStatus: 0, reason: "")),
            .ping(UInt64.max),
            .pong(0),
        ]
    }

    @Test func everyFrameRoundTrips() throws {
        for frame in allFrames() {
            let bytes = try frame.encode()
            #expect(bytes.count <= RelayProtocol.maxFrameLength)
            #expect(try Frame.decode(bytes) == frame)
        }
    }

    @Test func everyTruncationAndExtensionIsRejected() throws {
        for frame in allFrames() {
            let bytes = try frame.encode()
            // DATA's payload and PUSH's sealed push are "the rest", so only
            // cuts that leave them too short are truncation.
            let cuts: Range<Int>
            switch frame {
            case .data: cuts = 0..<6
            case .push(let p): cuts = 0..<(bytes.count - p.sealed.count + Push.nonceLength + Push.tagLength)
            default: cuts = 0..<bytes.count
            }
            for cut in cuts {
                #expect(thrown { () throws(FrameError) in try Frame.decode(bytes.prefix(cut)) } != nil, "\(frame.typeName) at \(cut)")
            }
            switch frame {
            case .data, .push: break
            default:
                let error = thrown { () throws(FrameError) in try Frame.decode(bytes + Data([0])) }
                #expect(error?.label == "trailing_bytes", "\(frame.typeName)")
            }
        }
    }

    @Test func badFieldsAreRejectedWithLabels() throws {
        func label(_ bytes: [UInt8]) -> String? {
            thrown { () throws(FrameError) in try Frame.decode(Data(bytes)) }?.label
        }
        #expect(label([]) == "empty")
        #expect(thrown { () throws(FrameError) in try Frame.decode(Data([0x00])) } == .unknownType(0x00))
        #expect(label([0x07, 0]) == "unknown_type")
        #expect(label([Frame.typeData, 0, 0, 0, 1]) == "truncated")
        #expect(label([Frame.typeData, 0, 0, 0, 1] + [UInt8](repeating: 0, count: RelayProtocol.maxDataPayload + 1)) == "invalid_field")
        // PEER: unknown role, online not 0/1, host id with client role.
        for bad: [UInt8] in [
            [Frame.typePeer, 0, 0, 0, 1, 3, 1], [Frame.typePeer, 0, 0, 0, 1, 2, 2],
            [Frame.typePeer, 0, 0, 0, 0, 2, 1], [Frame.typePeer, 0, 0, 0, 1, 1, 1],
        ] {
            #expect(label(bad) == "invalid_field", "\(bad)")
        }
        // PUSH: env, priority.
        let good = Array(try Frame.push(push()).encode())
        var badEnv = good
        badEnv[5] = 2
        var badPriority = good
        badPriority[6] = 9
        #expect(label(badEnv) == "invalid_field")
        #expect(label(badPriority) == "invalid_field")
        // PUSH: empty token, bad collapse ids, sealed too short or too long.
        var cases = [PushRequest]()
        var p = push()
        p.deviceToken = Data()
        cases.append(p)
        for id in ["a b", String(repeating: "x", count: 65), ""] {
            p = push()
            p.collapseID = id
            cases.append(p)
        }
        for count in [27, RelayProtocol.maxPushSealedLength + 1] {
            p = push()
            p.sealed = Data(count: count)
            cases.append(p)
        }
        for request in cases {
            #expect(thrown { () throws(FrameError) in try Frame.push(request).encode() } != nil)
        }
        // PUSH_RESULT: status / HTTP status must agree, reason printable.
        for result in [
            PushResult(requestID: 1, status: .ok, apnsStatus: 400, reason: ""),
            PushResult(requestID: 1, status: .unregistered, apnsStatus: 200, reason: ""),
            PushResult(requestID: 1, status: .failed, apnsStatus: 0, reason: "a\nb"),
        ] {
            #expect(thrown { () throws(FrameError) in try Frame.pushResult(result).encode() } != nil)
        }
        #expect(label([Frame.typePushResult, 0, 0, 0, 1, 3, 0, 0, 0]) == "invalid_field")
        // DATA with an empty payload cannot be built either.
        #expect(thrown { () throws(FrameError) in try Frame.data(peer: PeerID(1), payload: Data()).encode() } != nil)
    }

    @Test func deviceTokenHex() {
        #expect(DeviceToken.fromHex("00aBff") == Data([0x00, 0xab, 0xff]))
        #expect(DeviceToken.toHex(Data([0x00, 0xab, 0xff])) == "00abff")
        for bad in ["", "abc", "zz", "+1", "é1", String(repeating: "a", count: 2050)] {
            #expect(DeviceToken.fromHex(bad) == nil, "\(bad)")
        }
    }

    @Test func rolesAndHeaders() {
        for role in [Role.host, .client] {
            #expect(Role(code: role.code) == role)
            #expect(Role(headerValue: role.headerValue) == role)
        }
        #expect(Role(headerValue: "Host") == nil)
        #expect(PushEnv(code: 0) == .production && PushEnv(code: 1) == .sandbox && PushEnv(code: 2) == nil)
        #expect(PushPriority(code: 10) == .immediate && PushPriority(code: 9) == nil)
        #expect(PushStatus(code: 1) == .unregistered && PushStatus(code: 3) == nil)
    }
}
