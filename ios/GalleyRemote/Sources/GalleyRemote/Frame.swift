import Foundation

/// Relay connection constants (design §4.2; Rust `frame`).
public enum RelayProtocol {
    /// `X-Galley-Relay` header value: the version of the frame layer.
    public static let version: UInt8 = 1
    /// Path of the WebSocket upgrade, appended to the relay base URL.
    public static let connectPath = "/v1/connect"
    /// Connect header carrying `base64url(channel_secret)`
    /// (``ChannelSecret/headerValue``).
    public static let headerChannel = "X-Galley-Channel"
    /// Connect header carrying ``Role/headerValue``.
    public static let headerRole = "X-Galley-Role"
    /// Connect header carrying ``version``.
    public static let headerRelayVersion = "X-Galley-Relay"

    /// Largest Noise message (Noise spec §3), so the largest `DATA` payload.
    public static let maxDataPayload = 65535
    /// Largest frame of any type: a full `DATA` frame.
    public static let maxFrameLength = 1 + 4 + maxDataPayload
    /// Longest APNs device token carried.
    public static let maxDeviceTokenLength = 1024
    /// APNs `apns-collapse-id` limit.
    public static let maxCollapseIDLength = 64
    /// Longest sealed push a `PUSH` may carry (APNs payload ≤ 4096 bytes).
    public static let maxPushSealedLength = 2994
}

/// Which side of a channel a connection is.
public enum Role: Sendable, Hashable {
    /// Galley Core. One per channel.
    case host
    /// A phone.
    case client

    /// Byte in `PEER` frames and the Noise prologue.
    public var code: UInt8 {
        switch self {
        case .host: 0x01
        case .client: 0x02
        }
    }

    public init?(code: UInt8) {
        switch code {
        case 0x01: self = .host
        case 0x02: self = .client
        default: return nil
        }
    }

    /// `X-Galley-Role` header value.
    public var headerValue: String {
        switch self {
        case .host: "host"
        case .client: "client"
        }
    }

    public init?(headerValue: String) {
        switch headerValue {
        case "host": self = .host
        case "client": self = .client
        default: return nil
        }
    }
}

/// A connection within a channel, as the relay numbers it. Clients count
/// from 1; ``host`` is `0`. A phone always sees and writes ``host``.
public struct PeerID: Sendable, Hashable, Comparable {
    public var value: UInt32
    public init(_ value: UInt32) { self.value = value }
    public static let host = PeerID(0)
    public var isHost: Bool { self == .host }
    public static func < (a: PeerID, b: PeerID) -> Bool { a.value < b.value }
}

/// APNs environment of a device token (closed set, as in Rust).
public enum PushEnv: String, Codable, Sendable, Hashable {
    /// `api.push.apple.com`. Byte `0x00`.
    case production
    /// `api.sandbox.push.apple.com`. Byte `0x01`.
    case sandbox

    public var code: UInt8 {
        switch self {
        case .production: 0x00
        case .sandbox: 0x01
        }
    }

    public init?(code: UInt8) {
        switch code {
        case 0x00: self = .production
        case 0x01: self = .sandbox
        default: return nil
        }
    }
}

/// `apns-priority`; the byte is the APNs value itself.
public enum PushPriority: Sendable, Hashable {
    /// 10: deliver now (alerts).
    case immediate
    /// 5: by the device's power policy.
    case powerConsiderate
    /// 1: prioritize power.
    case powerSaving

    public var code: UInt8 {
        switch self {
        case .immediate: 10
        case .powerConsiderate: 5
        case .powerSaving: 1
        }
    }

    public init?(code: UInt8) {
        switch code {
        case 10: self = .immediate
        case 5: self = .powerConsiderate
        case 1: self = .powerSaving
        default: return nil
        }
    }
}

/// One push for the relay to send to APNs (host → relay; the phone never
/// sends it, it is here for parity with the fixtures).
public struct PushRequest: Sendable, Hashable {
    public var requestID: UInt32
    public var env: PushEnv
    public var priority: PushPriority
    public var deviceToken: Data
    public var collapseID: String?
    /// `nonce ‖ ciphertext` from ``Push/seal(key:content:)``.
    public var sealed: Data

    public init(
        requestID: UInt32, env: PushEnv, priority: PushPriority, deviceToken: Data,
        collapseID: String?, sealed: Data
    ) {
        self.requestID = requestID
        self.env = env
        self.priority = priority
        self.deviceToken = deviceToken
        self.collapseID = collapseID
        self.sealed = sealed
    }
}

/// Outcome of one ``PushRequest``.
public enum PushStatus: Sendable, Hashable {
    /// APNs accepted it (HTTP 200). Byte `0x00`.
    case ok
    /// APNs 410: the token is no longer valid. Byte `0x01`.
    case unregistered
    /// Anything else. Byte `0x02`.
    case failed

    public var code: UInt8 {
        switch self {
        case .ok: 0x00
        case .unregistered: 0x01
        case .failed: 0x02
        }
    }

    public init?(code: UInt8) {
        switch code {
        case 0x00: self = .ok
        case 0x01: self = .unregistered
        case 0x02: self = .failed
        default: return nil
        }
    }
}

/// The relay's answer to a ``PushRequest``.
public struct PushResult: Sendable, Hashable {
    public var requestID: UInt32
    public var status: PushStatus
    /// APNs HTTP status; `0` when APNs never answered.
    public var apnsStatus: UInt16
    /// Printable ASCII, at most 255 bytes, may be empty.
    public var reason: String

    public init(requestID: UInt32, status: PushStatus, apnsStatus: UInt16, reason: String) {
        self.requestID = requestID
        self.status = status
        self.apnsStatus = apnsStatus
        self.reason = reason
    }
}

/// One relay frame (a WebSocket binary message). First byte is the type;
/// integers are big-endian; every frame has exactly one layout:
///
/// | Type | Byte | Layout after the type byte |
/// |---|---|---|
/// | `DATA` | `0x01` | `peer u32` ‖ Noise message (1...65535 bytes) |
/// | `PEER` | `0x02` | `peer u32` ‖ `role u8` ‖ `online u8` |
/// | `PUSH` | `0x03` | `request_id u32` ‖ `env u8` ‖ `priority u8` ‖ `token_len u16` ‖ token ‖ `collapse_len u8` ‖ collapse id ‖ sealed push |
/// | `PUSH_RESULT` | `0x04` | `request_id u32` ‖ `status u8` ‖ `apns_status u16` ‖ `reason_len u8` ‖ reason |
/// | `PING` | `0x05` | `nonce u64` |
/// | `PONG` | `0x06` | `nonce u64` |
public enum Frame: Sendable, Hashable {
    case data(peer: PeerID, payload: Data)
    case peer(peer: PeerID, role: Role, online: Bool)
    case push(PushRequest)
    case pushResult(PushResult)
    case ping(UInt64)
    case pong(UInt64)

    public static let typeData: UInt8 = 0x01
    public static let typePeer: UInt8 = 0x02
    public static let typePush: UInt8 = 0x03
    public static let typePushResult: UInt8 = 0x04
    public static let typePing: UInt8 = 0x05
    public static let typePong: UInt8 = 0x06

    /// Name used in errors and fixtures (`DATA`, `PEER`, …).
    public var typeName: String {
        switch self {
        case .data: "DATA"
        case .peer: "PEER"
        case .push: "PUSH"
        case .pushResult: "PUSH_RESULT"
        case .ping: "PING"
        case .pong: "PONG"
        }
    }

    /// Encode, checking the same field rules ``decode(_:)`` enforces.
    public func encode() throws(FrameError) -> Data {
        let name = typeName
        var out = Data()
        switch self {
        case .data(let peer, let payload):
            guard !payload.isEmpty, payload.count <= RelayProtocol.maxDataPayload else {
                throw .invalidField(frame: name, field: "payload")
            }
            out.append(Frame.typeData)
            out.appendBigEndian(peer.value)
            out.append(payload)
        case .peer(let peer, let role, let online):
            guard peer.isHost == (role == .host) else {
                throw .invalidField(frame: name, field: "role")
            }
            out.append(Frame.typePeer)
            out.appendBigEndian(peer.value)
            out.append(role.code)
            out.append(online ? 1 : 0)
        case .push(let push):
            try Frame.validate(push)
            let collapse = Data((push.collapseID ?? "").utf8)
            out.append(Frame.typePush)
            out.appendBigEndian(push.requestID)
            out.append(push.env.code)
            out.append(push.priority.code)
            out.appendBigEndian(UInt16(push.deviceToken.count))
            out.append(push.deviceToken)
            out.append(UInt8(collapse.count))
            out.append(collapse)
            out.append(push.sealed)
        case .pushResult(let result):
            try Frame.validate(result)
            let reason = Data(result.reason.utf8)
            out.append(Frame.typePushResult)
            out.appendBigEndian(result.requestID)
            out.append(result.status.code)
            out.appendBigEndian(result.apnsStatus)
            out.append(UInt8(reason.count))
            out.append(reason)
        case .ping(let nonce):
            out.append(Frame.typePing)
            out.appendBigEndian(nonce)
        case .pong(let nonce):
            out.append(Frame.typePong)
            out.appendBigEndian(nonce)
        }
        return out
    }

    /// Strict decode of one WebSocket binary message.
    public static func decode(_ bytes: Data) throws(FrameError) -> Frame {
        guard let type = bytes.first else { throw .empty }
        var r = ByteReader(Data(bytes.dropFirst()))
        switch type {
        case typeData:
            let name = "DATA"
            guard let peer = r.u32() else { throw .truncated(frame: name) }
            let payload = r.rest()
            guard !payload.isEmpty else { throw .truncated(frame: name) }
            guard payload.count <= RelayProtocol.maxDataPayload else {
                throw .invalidField(frame: name, field: "payload")
            }
            return .data(peer: PeerID(peer), payload: payload)

        case typePeer:
            let name = "PEER"
            guard let peer = r.u32(), let roleByte = r.u8() else { throw .truncated(frame: name) }
            guard let role = Role(code: roleByte) else {
                throw .invalidField(frame: name, field: "role")
            }
            guard let onlineByte = r.u8() else { throw .truncated(frame: name) }
            let online: Bool
            switch onlineByte {
            case 0x00: online = false
            case 0x01: online = true
            default: throw .invalidField(frame: name, field: "online")
            }
            guard r.remaining == 0 else { throw .trailingBytes(frame: name) }
            guard PeerID(peer).isHost == (role == .host) else {
                throw .invalidField(frame: name, field: "role")
            }
            return .peer(peer: PeerID(peer), role: role, online: online)

        case typePush:
            let name = "PUSH"
            guard let requestID = r.u32(), let envByte = r.u8() else {
                throw .truncated(frame: name)
            }
            guard let env = PushEnv(code: envByte) else {
                throw .invalidField(frame: name, field: "env")
            }
            guard let priorityByte = r.u8() else { throw .truncated(frame: name) }
            guard let priority = PushPriority(code: priorityByte) else {
                throw .invalidField(frame: name, field: "priority")
            }
            guard let tokenLength = r.u16(), let token = r.take(Int(tokenLength)),
                let collapseLength = r.u8(), let collapse = r.take(Int(collapseLength))
            else { throw .truncated(frame: name) }
            let collapseID: String?
            if collapse.isEmpty {
                collapseID = nil
            } else if collapse.count <= RelayProtocol.maxCollapseIDLength,
                collapse.allSatisfy(isASCIIGraphic)
            {
                collapseID = String(decoding: collapse, as: UTF8.self)
            } else {
                throw .invalidField(frame: name, field: "collapse_id")
            }
            let push = PushRequest(
                requestID: requestID, env: env, priority: priority, deviceToken: token,
                collapseID: collapseID, sealed: r.rest())
            try validate(push)
            return .push(push)

        case typePushResult:
            let name = "PUSH_RESULT"
            guard let requestID = r.u32(), let statusByte = r.u8() else {
                throw .truncated(frame: name)
            }
            guard let status = PushStatus(code: statusByte) else {
                throw .invalidField(frame: name, field: "status")
            }
            guard let apnsStatus = r.u16(), let reasonLength = r.u8(),
                let reason = r.take(Int(reasonLength))
            else { throw .truncated(frame: name) }
            guard r.remaining == 0 else { throw .trailingBytes(frame: name) }
            guard reason.allSatisfy(isASCIIGraphic) else {
                throw .invalidField(frame: name, field: "reason")
            }
            let result = PushResult(
                requestID: requestID, status: status, apnsStatus: apnsStatus,
                reason: String(decoding: reason, as: UTF8.self))
            try validate(result)
            return .pushResult(result)

        case typePing, typePong:
            let name = type == typePing ? "PING" : "PONG"
            guard let nonce = r.u64() else { throw .truncated(frame: name) }
            guard r.remaining == 0 else { throw .trailingBytes(frame: name) }
            return type == typePing ? .ping(nonce) : .pong(nonce)

        default:
            throw .unknownType(type)
        }
    }

    private static func validate(_ push: PushRequest) throws(FrameError) {
        guard !push.deviceToken.isEmpty,
            push.deviceToken.count <= RelayProtocol.maxDeviceTokenLength
        else { throw .invalidField(frame: "PUSH", field: "device_token") }
        if let id = push.collapseID {
            let bytes = Array(id.utf8)
            guard !bytes.isEmpty, bytes.count <= RelayProtocol.maxCollapseIDLength,
                bytes.allSatisfy(isASCIIGraphic)
            else { throw .invalidField(frame: "PUSH", field: "collapse_id") }
        }
        let minSealed = Push.nonceLength + Push.tagLength
        guard push.sealed.count >= minSealed,
            push.sealed.count <= RelayProtocol.maxPushSealedLength
        else { throw .invalidField(frame: "PUSH", field: "sealed") }
    }

    private static func validate(_ result: PushResult) throws(FrameError) {
        let reason = Array(result.reason.utf8)
        guard reason.count <= Int(UInt8.max), reason.allSatisfy(isASCIIGraphic) else {
            throw .invalidField(frame: "PUSH_RESULT", field: "reason")
        }
        let consistent: Bool
        switch result.status {
        case .ok: consistent = result.apnsStatus == 200
        case .unregistered: consistent = result.apnsStatus == 410
        case .failed: consistent = true
        }
        guard consistent else { throw .invalidField(frame: "PUSH_RESULT", field: "apns_status") }
    }
}

/// Why bytes are not a valid frame. ``label`` is the relay's stable
/// counter label, the same strings as Rust's `FrameError::label`.
public enum FrameError: Error, Equatable, Sendable {
    case empty
    case unknownType(UInt8)
    /// Ended before the layout did.
    case truncated(frame: String)
    /// Bytes after the layout ended.
    case trailingBytes(frame: String)
    /// A field outside its allowed values or lengths.
    case invalidField(frame: String, field: String)

    public var label: String {
        switch self {
        case .empty: "empty"
        case .unknownType: "unknown_type"
        case .truncated: "truncated"
        case .trailingBytes: "trailing_bytes"
        case .invalidField: "invalid_field"
        }
    }
}

/// APNs device token conversions (Rust `device_token_from_hex` /
/// `device_token_to_hex`).
public enum DeviceToken {
    /// Hex (either case) as iOS prints a token, to raw bytes.
    public static func fromHex(_ hex: String) -> Data? {
        let count = hex.utf8.count
        guard count > 0, count % 2 == 0, count <= 2 * RelayProtocol.maxDeviceTokenLength else {
            return nil
        }
        return Hex.decode(hex)
    }

    /// Lowercase hex, as the APNs path wants it.
    public static func toHex(_ token: Data) -> String {
        Hex.encode(token)
    }
}
