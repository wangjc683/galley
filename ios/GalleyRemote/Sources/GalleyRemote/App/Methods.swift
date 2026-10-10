import Foundation

// P0 methods (design §6.3; Rust `app::methods`): phone → Core requests.

/// `{}`: params of a method that takes none, result of one that returns
/// nothing. Any object decodes (unknown fields ignored), and so does `[]`
/// (serde's empty-struct sequence form); nothing else does.
public struct Empty: Codable, Sendable, Hashable {
    public init() {}

    private struct AnyKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    public init(from decoder: any Decoder) throws {
        if (try? decoder.container(keyedBy: AnyKey.self)) != nil { return }
        let items = try decoder.unkeyedContainer()
        guard items.isAtEnd else {
            throw DecodingError.dataCorruptedError(in: items, debugDescription: "Empty takes no elements")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        _ = encoder.container(keyedBy: AnyKey.self)
    }
}

/// `hello` params: the phone's first request (design §6.2).
public struct HelloParams: Codable, Sendable, Hashable {
    public var `protocol`: ProtocolVersion
    public var appVersion: String

    public init(protocol: ProtocolVersion = .current, appVersion: String) {
        self.protocol = `protocol`
        self.appVersion = appVersion
    }
}

/// Core's hello: the payload of Noise handshake message 2, and the result
/// of `hello`.
public struct CoreHello: Codable, Sendable, Hashable {
    public var `protocol`: ProtocolVersion
    /// Galley desktop version (`0.6.2`).
    public var coreVersion: String
    public var desktopName: String

    public init(protocol: ProtocolVersion, coreVersion: String, desktopName: String) {
        self.protocol = `protocol`
        self.coreVersion = coreVersion
        self.desktopName = desktopName
    }
}

/// `sessions.list` result: everything the session list needs, in full.
public struct SessionsListResult: Codable, Sendable, Hashable {
    /// Non-archived sessions of the managed runtime.
    public var sessions: [Session]
    /// All projects, for grouping.
    public var projects: [Project]
    /// Run state of every session that is not idle; missing means idle.
    public var runStates: [SessionRunState]
}

/// `session.messages` page sizes.
public enum MessagesPage {
    /// Default page size.
    public static let defaultLimit: UInt32 = 50
    /// Largest page; larger `limit`s are clamped.
    public static let maxLimit: UInt32 = 200
}

/// `session.messages` params: the newest visible rows older than `before`.
public struct SessionMessagesParams: Codable, Sendable, Hashable {
    public var sessionId: String
    /// A message id from an earlier page; `nil` for the tail.
    public var before: String?
    /// `nil` for ``MessagesPage/defaultLimit``.
    public var limit: UInt32?

    public init(sessionId: String, before: String? = nil, limit: UInt32? = nil) {
        self.sessionId = sessionId
        self.before = before
        self.limit = limit
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(before, forKey: .before)
        try c.encode(limit, forKey: .limit)
    }
}

/// `session.messages` result, oldest first.
public struct SessionMessagesResult: Codable, Sendable, Hashable {
    public var messages: [Message]
    /// Older rows exist before the first one returned.
    public var hasMore: Bool
}

/// Image limits of one send (`core/src/commands/session.rs`).
public enum ImageLimits {
    public static let maxImagesPerMessage = 4
    /// Largest image, decoded.
    public static let maxImageBytes = 10 * 1024 * 1024
    /// Largest total of one message's images, decoded.
    public static let maxMessageImageBytes = 25 * 1024 * 1024
}

/// One image of a send: PNG, JPEG or WebP, compressed on the phone first.
public struct ImageUpload: Codable, Sendable, Hashable {
    /// `image/png` | `image/jpeg` | `image/webp`.
    public var mimeType: String
    /// Standard base64 of the image bytes.
    public var data: String
    public var width: UInt32?
    public var height: UInt32?

    public init(mimeType: String, data: String, width: UInt32?, height: UInt32?) {
        self.mimeType = mimeType
        self.data = data
        self.width = width
        self.height = height
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(mimeType, forKey: .mimeType)
        try c.encode(data, forKey: .data)
        try c.encode(width, forKey: .width)
        try c.encode(height, forKey: .height)
    }
}

/// `session.send` params (sent as `via = gui`, `client = ios`).
public struct SessionSendParams: Codable, Sendable, Hashable {
    public var sessionId: String
    public var text: String
    /// Absent reads as `[]` (Rust `#[serde(default)]`).
    public var images: [ImageUpload]
    /// The phone's id for this send, echoed on `message.persisted`.
    public var clientRequestId: String?

    enum CodingKeys: String, CodingKey {
        case sessionId, text, images, clientRequestId
    }

    public init(sessionId: String, text: String, images: [ImageUpload] = [], clientRequestId: String?) {
        self.sessionId = sessionId
        self.text = text
        self.images = images
        self.clientRequestId = clientRequestId
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try c.decode(String.self, forKey: .sessionId)
        text = try c.decode(String.self, forKey: .text)
        images = c.contains(.images) ? try c.decode([ImageUpload].self, forKey: .images) : []
        clientRequestId = try c.decodeIfPresent(String.self, forKey: .clientRequestId)
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(text, forKey: .text)
        try c.encode(images, forKey: .images)
        try c.encode(clientRequestId, forKey: .clientRequestId)
    }
}

/// What a send did.
public enum SendOutcome: String, Codable, Sendable, Hashable, CaseIterable {
    /// Persisted and handed to the runner.
    case dispatched
    /// Waiting behind an open run (text only).
    case queued
    /// A `/btw` side question: dispatched, not persisted.
    case sideQuestion = "side_question"
    case unknown

    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = SendOutcome(rawValue: raw) ?? .unknown
    }
}

/// Where a queued send sits.
public struct QueuedPlacement: Codable, Sendable, Hashable {
    public var queueId: String
    /// 0-based within the session's queue.
    public var position: UInt32
}

/// `session.send` result.
public struct SessionSendResult: Codable, Sendable, Hashable {
    public var outcome: SendOutcome
    /// The persisted row, on `dispatched`.
    public var message: Message?
    /// On `queued`.
    public var queue: QueuedPlacement?

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(outcome, forKey: .outcome)
        try c.encode(message, forKey: .message)
        try c.encode(queue, forKey: .queue)
    }
}

/// Params naming one session: `session.stop`, `session.markRead`,
/// `session.subscribe`, `session.unsubscribe`.
public struct SessionIdParams: Codable, Sendable, Hashable {
    public var sessionId: String
    public init(sessionId: String) { self.sessionId = sessionId }
}

/// What `session.stop` did (Core `StopOutcome`).
public enum StopDispatch: String, Codable, Sendable, Hashable, CaseIterable {
    case abortSent = "abort_sent"
    case alreadyStopped = "already_stopped"
    case unknown

    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = StopDispatch(rawValue: raw) ?? .unknown
    }
}

public struct SessionStopResult: Codable, Sendable, Hashable {
    public var dispatch: StopDispatch
}

/// `session.create` params. Core mints the id.
public struct SessionCreateParams: Codable, Sendable, Hashable {
    public var projectId: String?
    /// `nil` for Core's default title.
    public var title: String?

    public init(projectId: String? = nil, title: String? = nil) {
        self.projectId = projectId
        self.title = title
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(projectId, forKey: .projectId)
        try c.encode(title, forKey: .title)
    }
}

public struct SessionCreateResult: Codable, Sendable, Hashable {
    public var session: Session
}

/// `attachment.read` params.
public struct AttachmentReadParams: Codable, Sendable, Hashable {
    public var sessionId: String
    public var attachmentId: String

    public init(sessionId: String, attachmentId: String) {
        self.sessionId = sessionId
        self.attachmentId = attachmentId
    }
}

/// `attachment.read` result; usually arrives chunked.
public struct AttachmentReadResult: Codable, Sendable, Hashable {
    public var attachmentId: String
    public var mimeType: String
    public var byteSize: UInt64
    /// Standard base64 of the file.
    public var data: String
}

/// `device.registerPush` params: the phone's APNs token.
public struct RegisterPushParams: Codable, Sendable, Hashable {
    /// Device token as hex (``DeviceToken/toHex(_:)``).
    public var token: String
    /// Sandbox for development builds.
    public var env: PushEnv

    public init(token: String, env: PushEnv) {
        self.token = token
        self.env = env
    }
}

/// The P0 methods, one marker type each (Rust: unit structs implementing
/// `Method`).
public enum Methods {
    /// Version handshake (design §6.2).
    public enum Hello: RemoteMethod {
        public typealias Params = HelloParams
        public typealias Result = CoreHello
        public static let name = "hello"
    }
    /// The whole session list with projects and run states.
    public enum SessionsList: RemoteMethod {
        public typealias Params = Empty
        public typealias Result = SessionsListResult
        public static let name = "sessions.list"
    }
    /// A page of a session's messages.
    public enum SessionMessages: RemoteMethod {
        public typealias Params = SessionMessagesParams
        public typealias Result = SessionMessagesResult
        public static let name = "session.messages"
    }
    /// Send a user message (text, images).
    public enum SessionSend: RemoteMethod {
        public typealias Params = SessionSendParams
        public typealias Result = SessionSendResult
        public static let name = "session.send"
    }
    /// Stop the session's run.
    public enum SessionStop: RemoteMethod {
        public typealias Params = SessionIdParams
        public typealias Result = SessionStopResult
        public static let name = "session.stop"
    }
    /// Create a session.
    public enum SessionCreate: RemoteMethod {
        public typealias Params = SessionCreateParams
        public typealias Result = SessionCreateResult
        public static let name = "session.create"
    }
    /// Clear the session's unread mark.
    public enum SessionMarkRead: RemoteMethod {
        public typealias Params = SessionIdParams
        public typealias Result = Empty
        public static let name = "session.markRead"
    }
    /// Start receiving `runner.event` for this session.
    public enum SessionSubscribe: RemoteMethod {
        public typealias Params = SessionIdParams
        public typealias Result = Empty
        public static let name = "session.subscribe"
    }
    /// Stop receiving `runner.event` for this session.
    public enum SessionUnsubscribe: RemoteMethod {
        public typealias Params = SessionIdParams
        public typealias Result = Empty
        public static let name = "session.unsubscribe"
    }
    /// Read one attachment's bytes.
    public enum AttachmentRead: RemoteMethod {
        public typealias Params = AttachmentReadParams
        public typealias Result = AttachmentReadResult
        public static let name = "attachment.read"
    }
    /// Register the phone's APNs token.
    public enum DeviceRegisterPush: RemoteMethod {
        public typealias Params = RegisterPushParams
        public typealias Result = Empty
        public static let name = "device.registerPush"
    }

    /// Every P0 method, in the design's order (Rust `METHODS`).
    public static var all: [any RemoteMethod.Type] {
        [
            Hello.self, SessionsList.self, SessionMessages.self, SessionSend.self, SessionStop.self,
            SessionCreate.self, SessionMarkRead.self, SessionSubscribe.self, SessionUnsubscribe.self,
            AttachmentRead.self, DeviceRegisterPush.self,
        ]
    }

    public static var names: [String] { all.map { $0.name } }
}

/// A decoded request, one case per method (Rust `ClientRequest`). Core
/// dispatches on it; the phone builds requests with ``toRequest(id:)``.
public enum ClientRequest: Sendable, Hashable {
    case hello(HelloParams)
    case sessionsList(Empty)
    case sessionMessages(SessionMessagesParams)
    case sessionSend(SessionSendParams)
    case sessionStop(SessionIdParams)
    case sessionCreate(SessionCreateParams)
    case sessionMarkRead(SessionIdParams)
    case sessionSubscribe(SessionIdParams)
    case sessionUnsubscribe(SessionIdParams)
    case attachmentRead(AttachmentReadParams)
    case deviceRegisterPush(RegisterPushParams)

    public var method: String {
        switch self {
        case .hello: Methods.Hello.name
        case .sessionsList: Methods.SessionsList.name
        case .sessionMessages: Methods.SessionMessages.name
        case .sessionSend: Methods.SessionSend.name
        case .sessionStop: Methods.SessionStop.name
        case .sessionCreate: Methods.SessionCreate.name
        case .sessionMarkRead: Methods.SessionMarkRead.name
        case .sessionSubscribe: Methods.SessionSubscribe.name
        case .sessionUnsubscribe: Methods.SessionUnsubscribe.name
        case .attachmentRead: Methods.AttachmentRead.name
        case .deviceRegisterPush: Methods.DeviceRegisterPush.name
        }
    }

    /// Decode `request`'s params by its method. The error is the `e` to
    /// answer with: `unknown_method` or `invalid_params`.
    public init(request: Request) throws(ErrorBody) {
        switch request.method {
        case Methods.Hello.name: self = .hello(try request.params(Methods.Hello.self))
        case Methods.SessionsList.name: self = .sessionsList(try request.params(Methods.SessionsList.self))
        case Methods.SessionMessages.name:
            self = .sessionMessages(try request.params(Methods.SessionMessages.self))
        case Methods.SessionSend.name: self = .sessionSend(try request.params(Methods.SessionSend.self))
        case Methods.SessionStop.name: self = .sessionStop(try request.params(Methods.SessionStop.self))
        case Methods.SessionCreate.name: self = .sessionCreate(try request.params(Methods.SessionCreate.self))
        case Methods.SessionMarkRead.name:
            self = .sessionMarkRead(try request.params(Methods.SessionMarkRead.self))
        case Methods.SessionSubscribe.name:
            self = .sessionSubscribe(try request.params(Methods.SessionSubscribe.self))
        case Methods.SessionUnsubscribe.name:
            self = .sessionUnsubscribe(try request.params(Methods.SessionUnsubscribe.self))
        case Methods.AttachmentRead.name: self = .attachmentRead(try request.params(Methods.AttachmentRead.self))
        case Methods.DeviceRegisterPush.name:
            self = .deviceRegisterPush(try request.params(Methods.DeviceRegisterPush.self))
        default: throw .unknownMethod(request.method)
        }
    }

    public func toRequest(id: UInt64) -> Request {
        switch self {
        case .hello(let p): Request(id: id, Methods.Hello.self, params: p)
        case .sessionsList(let p): Request(id: id, Methods.SessionsList.self, params: p)
        case .sessionMessages(let p): Request(id: id, Methods.SessionMessages.self, params: p)
        case .sessionSend(let p): Request(id: id, Methods.SessionSend.self, params: p)
        case .sessionStop(let p): Request(id: id, Methods.SessionStop.self, params: p)
        case .sessionCreate(let p): Request(id: id, Methods.SessionCreate.self, params: p)
        case .sessionMarkRead(let p): Request(id: id, Methods.SessionMarkRead.self, params: p)
        case .sessionSubscribe(let p): Request(id: id, Methods.SessionSubscribe.self, params: p)
        case .sessionUnsubscribe(let p): Request(id: id, Methods.SessionUnsubscribe.self, params: p)
        case .attachmentRead(let p): Request(id: id, Methods.AttachmentRead.self, params: p)
        case .deviceRegisterPush(let p): Request(id: id, Methods.DeviceRegisterPush.self, params: p)
        }
    }
}
