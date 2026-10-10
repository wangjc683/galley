import Foundation

// End-to-end app protocol (design §6; Rust `app`): JSON messages inside
// the Noise session, one per `APP` record, larger ones split into
// `chunk`s (Chunk.swift).
//
//     {"t":"req","id":7,"m":"session.send","p":{...}}
//     {"t":"res","id":7,"ok":true,"r":{...}}
//     {"t":"res","id":7,"ok":false,"e":{"code":"images_not_queueable","message":"..."}}
//     {"t":"evt","n":"session.updated","p":{...}}
//     {"t":"chunk","id":3,"i":0,"last":false,"data":"<base64>"}
//
// Within a protocol major, fields and methods are only added: decoders
// ignore unknown fields and events, an unknown enum value decodes as that
// enum's `unknown`. Optional fields are written as explicit `null` and
// read back from `null` or absent (02d's rule).

/// App protocol version: `{major, minor}`.
public struct ProtocolVersion: Codable, Sendable, Hashable {
    public var major: UInt32
    public var minor: UInt32

    public init(major: UInt32, minor: UInt32) {
        self.major = major
        self.minor = minor
    }

    /// The version this package speaks.
    public static let current = ProtocolVersion(major: 1, minor: 0)

    /// Same major: the two ends can talk (design §6.2).
    public func isCompatible(with other: ProtocolVersion) -> Bool {
        major == other.major
    }
}

/// Error codes of `res` messages. Core's own stable labels pass through;
/// a code the phone does not know is a generic failure showing `message`.
public enum ErrorCode {
    public static let unknownMethod = "unknown_method"
    public static let invalidParams = "invalid_params"
    public static let protocolMismatch = "protocol_mismatch"
    public static let notFound = "not_found"
    public static let invalidArgs = "invalid_args"
    public static let dbUnavailable = "db_unavailable"
    public static let runnerError = "runner_error"
    public static let `internal` = "internal"
    public static let imagesNotSupported = "images_not_supported"
    public static let imagesNotQueueable = "images_not_queueable"
    public static let imagesNotAllowed = "images_not_allowed"
    public static let dispatchFailed = "dispatch_failed"
    public static let historyReplay = "history_replay"
}

/// The `e` of a failed `res`.
public struct ErrorBody: Codable, Error, Sendable, Hashable {
    /// A stable label (``ErrorCode``).
    public var code: String
    /// Human-readable detail; absent reads as `""` (Rust `#[serde(default)]`).
    public var message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }

    public static func unknownMethod(_ method: String) -> ErrorBody {
        // Rust formats the name with `{:?}`.
        var quoted = ""
        JSONWriter.writeString(method, into: &quoted)
        return ErrorBody(code: ErrorCode.unknownMethod, message: "unknown method \(quoted)")
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        message = c.contains(.message) ? try c.decode(String.self, forKey: .message) : ""
    }
}

/// Why bytes are not a valid app message (Rust `AppError`).
public enum AppError: Error, Equatable, Sendable {
    /// Not JSON, or a field of the wrong type.
    case json(String)
    /// A `t` this version does not know.
    case unknownType(String)
    case missingField(messageType: String, field: String)
    /// Fields that contradict each other (`ok: true` with `e`, …).
    case inconsistent(String)
    /// A chunk out of order, empty, too large, not base64, or wrapping
    /// another chunk.
    case badChunk(String)
    /// A message larger than the reassembly limit.
    case tooLarge(limit: Int)
    /// More chunked messages in flight than allowed.
    case tooManyStreams(limit: Int)
}

/// A method: its wire name and its params / result types (Rust `Method`).
public protocol RemoteMethod {
    associatedtype Params: Codable & Sendable & Equatable
    associatedtype Result: Codable & Sendable & Equatable
    static var name: String { get }
}

/// `{"t":"req"}`.
public struct Request: Sendable, Hashable {
    public var id: UInt64
    public var method: String
    /// Raw params; decode with ``params(_:)`` or ``ClientRequest/init(request:)``.
    public var params: JSONValue

    public init(id: UInt64, method: String, params: JSONValue) {
        self.id = id
        self.method = method
        self.params = params
    }

    public init<M: RemoteMethod>(id: UInt64, _ method: M.Type, params: M.Params) {
        self.init(id: id, method: M.name, params: JSONValue.encodingAppType(params))
    }

    /// Typed params of method `M`: ``ErrorCode/invalidParams`` when they
    /// do not fit, ``ErrorCode/unknownMethod`` when this is not `M`.
    public func params<M: RemoteMethod>(_ method: M.Type) throws(ErrorBody) -> M.Params {
        guard self.method == M.name else { throw .unknownMethod(self.method) }
        do {
            return try params.decode(M.Params.self)
        } catch {
            throw ErrorBody(code: ErrorCode.invalidParams, message: String(describing: error))
        }
    }
}

/// `{"t":"res"}`: `.success(r)` for `ok: true`, `.failure(e)` for `ok: false`.
public struct Response: Sendable, Hashable {
    public var id: UInt64
    public var outcome: Result<JSONValue, ErrorBody>

    public init(id: UInt64, outcome: Result<JSONValue, ErrorBody>) {
        self.id = id
        self.outcome = outcome
    }

    public static func ok<M: RemoteMethod>(id: UInt64, _ method: M.Type, result: M.Result) -> Response {
        Response(id: id, outcome: .success(JSONValue.encodingAppType(result)))
    }

    public static func error(id: UInt64, _ error: ErrorBody) -> Response {
        Response(id: id, outcome: .failure(error))
    }

    /// Typed result of method `M` (the caller knows which request `id`
    /// was): the result or Core's error; throws when `r` does not fit.
    public func result<M: RemoteMethod>(_ method: M.Type) throws(AppError) -> Result<M.Result, ErrorBody> {
        switch outcome {
        case .success(let r):
            do {
                return .success(try r.decode(M.Result.self))
            } catch {
                throw .json(String(describing: error))
            }
        case .failure(let e):
            return .failure(e)
        }
    }
}

/// `{"t":"evt"}`.
public struct Event: Sendable, Hashable {
    public var name: String
    public var payload: JSONValue

    public init(name: String, payload: JSONValue) {
        self.name = name
        self.payload = payload
    }
}

/// `{"t":"chunk"}`: piece `index` of the message `id` (a sender-local
/// stream id, not a request id); `data` is base64 on the wire.
public struct Chunk: Sendable, Hashable {
    public var id: UInt64
    public var index: UInt32
    public var last: Bool
    public var data: Data

    public init(id: UInt64, index: UInt32, last: Bool, data: Data) {
        self.id = id
        self.index = index
        self.last = last
        self.data = data
    }
}

/// One app message.
public enum Envelope: Sendable, Hashable {
    case request(Request)
    case response(Response)
    case event(Event)
    case chunk(Chunk)

    /// The JSON bytes of this message, fields in Rust's wire order.
    public func toJSON() -> Data {
        var out = "{\"t\":"
        func field(_ name: String, _ value: JSONValue) {
            out += ",\"\(name)\":"
            JSONWriter.write(value, into: &out)
        }
        switch self {
        case .request(let req):
            out += "\"req\""
            field("id", .uint(req.id))
            field("m", .string(req.method))
            field("p", req.params)
        case .response(let res):
            out += "\"res\""
            field("id", .uint(res.id))
            switch res.outcome {
            case .success(let r):
                field("ok", .bool(true))
                field("r", r)
            case .failure(let e):
                field("ok", .bool(false))
                field("e", .object(["code": .string(e.code), "message": .string(e.message)]))
            }
        case .event(let evt):
            out += "\"evt\""
            field("n", .string(evt.name))
            field("p", evt.payload)
        case .chunk(let chunk):
            out += "\"chunk\""
            field("id", .uint(chunk.id))
            field("i", .uint(UInt64(chunk.index)))
            field("last", .bool(chunk.last))
            field("data", .string(Base64.encode(chunk.data, .standard)))
        }
        out += "}"
        return Data(out.utf8)
    }

    /// Every envelope field; `t` decides which must be there.
    private struct Wire: Decodable {
        let t: String
        let id: UInt64?
        let m: String?
        let n: String?
        let ok: Bool?
        let p: JSONValue?
        let r: JSONValue?
        let e: ErrorBody?
        let i: UInt32?
        let last: Bool?
        let data: String?
    }

    /// Strict decode of one message. Unknown fields are ignored; a missing
    /// (or `null`) `p` reads as `{}`.
    public static func fromJSON(_ bytes: Data) throws(AppError) -> Envelope {
        let wire: Wire
        do {
            wire = try JSONDecoder().decode(Wire.self, from: bytes)
        } catch {
            throw .json(String(describing: error))
        }
        func required<T>(_ value: T?, _ type: String, _ field: String) throws(AppError) -> T {
            guard let value else { throw .missingField(messageType: type, field: field) }
            return value
        }
        switch wire.t {
        case "req":
            return .request(
                Request(
                    id: try required(wire.id, "req", "id"), method: try required(wire.m, "req", "m"),
                    params: wire.p ?? .object([:])))
        case "res":
            let id = try required(wire.id, "res", "id")
            let ok = try required(wire.ok, "res", "ok")
            let outcome: Result<JSONValue, ErrorBody>
            switch (ok, wire.r, wire.e) {
            case (true, .some(let r), .none): outcome = .success(r)
            case (false, .none, .some(let e)): outcome = .failure(e)
            case (true, .none, _): throw .missingField(messageType: "res", field: "r")
            case (false, _, .none): throw .missingField(messageType: "res", field: "e")
            case (true, .some, .some): throw .inconsistent("ok with e")
            case (false, .some, .some): throw .inconsistent("error with r")
            }
            return .response(Response(id: id, outcome: outcome))
        case "evt":
            return .event(Event(name: try required(wire.n, "evt", "n"), payload: wire.p ?? .object([:])))
        case "chunk":
            let text = try required(wire.data, "chunk", "data")
            let id = try required(wire.id, "chunk", "id")
            let index = try required(wire.i, "chunk", "i")
            let last = try required(wire.last, "chunk", "last")
            guard let data = Base64.decode(text, .standard) else {
                throw .badChunk("data is not base64")
            }
            return .chunk(Chunk(id: id, index: index, last: last, data: data))
        default:
            throw .unknownType(wire.t)
        }
    }
}

extension JSONValue {
    /// App types are plain data (string keys, no floats), so this cannot
    /// fail (Rust `app::to_value`).
    static func encodingAppType<T: Encodable>(_ value: T) -> JSONValue {
        do {
            return try JSONValue(encoding: value)
        } catch {
            preconditionFailure("app protocol types always encode: \(error)")
        }
    }
}
