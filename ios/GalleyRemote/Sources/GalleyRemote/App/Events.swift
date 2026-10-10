import Foundation

// Events (design §6.4; Rust `app::events`): Core → phone, best effort. A
// missed event is repaired by re-reading (design §6.5). An event name this
// version does not know is ignored (`AppEvent(event:)` returns `nil`).

/// `session.created` / `updated` / `archived` / `unarchived` / `moved`.
public struct SessionEvent: Codable, Sendable, Hashable {
    public var session: Session
    /// Who wrote: `gui`, a socket command name, or a Core task.
    public var via: String
}

/// `session.deleted`.
public struct SessionDeletedEvent: Codable, Sendable, Hashable {
    public var sessionId: String
    public var via: String
}

/// `project.created` / `project.updated`.
public struct ProjectEvent: Codable, Sendable, Hashable {
    public var project: Project
    public var via: String
}

/// `project.deleted`. The project's sessions survive, moved out of it.
public struct ProjectDeletedEvent: Codable, Sendable, Hashable {
    public var projectId: String
    public var detachedSessionIds: [String]
}

/// Where a persisted user message stands.
public enum Dispatch: String, Codable, Sendable, Hashable, CaseIterable {
    /// Saved; the runner has not taken it yet.
    case pending
    case dispatched
    /// Saved, but nothing is running it.
    case persistedOnly = "persisted_only"
    case unknown

    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Dispatch(rawValue: raw) ?? .unknown
    }
}

/// `message.persisted`: a user message reached the database, from any
/// sender. One message can be announced twice with the same id.
public struct MessagePersistedEvent: Codable, Sendable, Hashable {
    public var sessionId: String
    public var message: Message
    public var dispatch: Dispatch
    /// The sender's own id for the send; `nil` from other senders.
    public var clientRequestId: String?

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(message, forKey: .message)
        try c.encode(dispatch, forKey: .dispatch)
        try c.encode(clientRequestId, forKey: .clientRequestId)
    }
}

/// `runner.event`: runner IPC events of a subscribed session, in order,
/// each exactly as Core's `IpcEvent` serializes it (passed through untyped).
public struct RunnerEventBatch: Codable, Sendable, Hashable {
    public var sessionId: String
    public var events: [JSONValue]
}

/// Replay phase of a runner taking a session's history.
public enum ReplayPhase: String, Codable, Sendable, Hashable, CaseIterable {
    case started, done, failed, unknown

    public init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ReplayPhase(rawValue: raw) ?? .unknown
    }
}

/// `history.replay`: the phone shows "restoring" on `started`.
public struct HistoryReplayEvent: Codable, Sendable, Hashable {
    public var sessionId: String
    public var phase: ReplayPhase
}

/// `goal.updated`: Core's `GoalBrief`, passed through (the Goal family's
/// shape belongs to the Agent API, schema 2).
public struct GoalUpdatedEvent: Codable, Sendable, Hashable {
    public var goal: JSONValue

    public init(goal: JSONValue) {
        self.goal = goal
    }

    public init(from decoder: any Decoder) throws {
        // Rust `goal: Value`: required, but `null` is a value.
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard c.contains(.goal) else {
            throw DecodingError.keyNotFound(
                CodingKeys.goal, .init(codingPath: c.codingPath, debugDescription: "missing goal"))
        }
        goal = try c.decodeNil(forKey: .goal) ? .null : c.decode(JSONValue.self, forKey: .goal)
    }
}

/// `queue.changed`: the whole queue.
public struct QueueChangedEvent: Codable, Sendable, Hashable {
    public var sessionId: String
    public var items: [QueuedMessage]
}

/// `sync.required`: Core dropped events for this phone; re-read.
public struct SyncRequiredEvent: Codable, Sendable, Hashable {
    /// Re-read this session's messages; `nil`: re-read everything.
    public var sessionId: String?

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(sessionId, forKey: .sessionId)
    }
}

/// A decoded event, one case per name (Rust `AppEvent`).
public enum AppEvent: Sendable, Hashable {
    case sessionCreated(SessionEvent)
    case sessionUpdated(SessionEvent)
    case sessionArchived(SessionEvent)
    case sessionUnarchived(SessionEvent)
    case sessionMoved(SessionEvent)
    case sessionDeleted(SessionDeletedEvent)
    case projectCreated(ProjectEvent)
    case projectUpdated(ProjectEvent)
    case projectDeleted(ProjectDeletedEvent)
    case messagePersisted(MessagePersistedEvent)
    /// Only for subscribed sessions.
    case runnerEvent(RunnerEventBatch)
    case sessionRunState(SessionRunState)
    case historyReplay(HistoryReplayEvent)
    case goalUpdated(GoalUpdatedEvent)
    case queueChanged(QueueChangedEvent)
    case syncRequired(SyncRequiredEvent)

    /// Every event name, in the design's order (Rust `EVENTS`).
    public static let names = [
        "session.created", "session.updated", "session.archived", "session.unarchived",
        "session.moved", "session.deleted", "project.created", "project.updated",
        "project.deleted", "message.persisted", "runner.event", "session.runState",
        "history.replay", "goal.updated", "queue.changed", "sync.required",
    ]

    public var name: String {
        switch self {
        case .sessionCreated: "session.created"
        case .sessionUpdated: "session.updated"
        case .sessionArchived: "session.archived"
        case .sessionUnarchived: "session.unarchived"
        case .sessionMoved: "session.moved"
        case .sessionDeleted: "session.deleted"
        case .projectCreated: "project.created"
        case .projectUpdated: "project.updated"
        case .projectDeleted: "project.deleted"
        case .messagePersisted: "message.persisted"
        case .runnerEvent: "runner.event"
        case .sessionRunState: "session.runState"
        case .historyReplay: "history.replay"
        case .goalUpdated: "goal.updated"
        case .queueChanged: "queue.changed"
        case .syncRequired: "sync.required"
        }
    }

    /// The typed payload.
    public var payload: any Codable & Sendable {
        switch self {
        case .sessionCreated(let p), .sessionUpdated(let p), .sessionArchived(let p),
            .sessionUnarchived(let p), .sessionMoved(let p):
            p
        case .sessionDeleted(let p): p
        case .projectCreated(let p), .projectUpdated(let p): p
        case .projectDeleted(let p): p
        case .messagePersisted(let p): p
        case .runnerEvent(let p): p
        case .sessionRunState(let p): p
        case .historyReplay(let p): p
        case .goalUpdated(let p): p
        case .queueChanged(let p): p
        case .syncRequired(let p): p
        }
    }

    public func toEvent() -> Event {
        Event(name: name, payload: JSONValue.encodingAppType(payload))
    }

    /// `nil` for an event name this version does not know (ignore it);
    /// throws when a known event's payload does not fit.
    public init?(event: Event) throws(AppError) {
        func decode<T: Decodable>(_ type: T.Type) throws(AppError) -> T {
            do {
                return try event.payload.decode(type)
            } catch {
                throw .json(String(describing: error))
            }
        }
        switch event.name {
        case "session.created": self = .sessionCreated(try decode(SessionEvent.self))
        case "session.updated": self = .sessionUpdated(try decode(SessionEvent.self))
        case "session.archived": self = .sessionArchived(try decode(SessionEvent.self))
        case "session.unarchived": self = .sessionUnarchived(try decode(SessionEvent.self))
        case "session.moved": self = .sessionMoved(try decode(SessionEvent.self))
        case "session.deleted": self = .sessionDeleted(try decode(SessionDeletedEvent.self))
        case "project.created": self = .projectCreated(try decode(ProjectEvent.self))
        case "project.updated": self = .projectUpdated(try decode(ProjectEvent.self))
        case "project.deleted": self = .projectDeleted(try decode(ProjectDeletedEvent.self))
        case "message.persisted": self = .messagePersisted(try decode(MessagePersistedEvent.self))
        case "runner.event": self = .runnerEvent(try decode(RunnerEventBatch.self))
        case "session.runState": self = .sessionRunState(try decode(SessionRunState.self))
        case "history.replay": self = .historyReplay(try decode(HistoryReplayEvent.self))
        case "goal.updated": self = .goalUpdated(try decode(GoalUpdatedEvent.self))
        case "queue.changed": self = .queueChanged(try decode(QueueChangedEvent.self))
        case "sync.required": self = .syncRequired(try decode(SyncRequiredEvent.self))
        default: return nil
        }
    }
}
