import Foundation

// Data the phone reads: sessions, projects, messages, run state (design
// §6.3, §6.4; Rust `app::types`). Property names are the wire's camelCase
// keys. Optionals decode from `null` or absent and encode as explicit
// `null` (hence the hand-written `encode(to:)`s); open enums decode a
// value this version does not know as `.unknown`.

/// Decodes a string enum, mapping values this version does not know to
/// `unknown` (Rust `#[serde(other)] Unknown`).
private func openEnum<E: RawRepresentable>(
    _ decoder: any Decoder, unknown: E
) throws -> E where E.RawValue == String {
    let raw = try decoder.singleValueContainer().decode(String.self)
    return E(rawValue: raw) ?? unknown
}

/// Session lifecycle (Core `SessionStatus`).
public enum SessionStatus: String, Codable, Sendable, Hashable, CaseIterable {
    case idle, connecting, running
    case waitingApproval = "waiting_approval"
    case error, completed, cancelled, archived, unknown

    public init(from decoder: any Decoder) throws {
        self = try openEnum(decoder, unknown: .unknown)
    }
}

/// Who triggered a write (Core `OriginVia`).
public enum OriginVia: String, Codable, Sendable, Hashable, CaseIterable {
    case gui, cli, supervisor, system, unknown

    public init(from decoder: any Decoder) throws {
        self = try openEnum(decoder, unknown: .unknown)
    }
}

/// Core `Origin`.
public struct Origin: Codable, Sendable, Hashable {
    public var via: OriginVia
    public var supervisor: String?
    public var reason: String?

    public init(via: OriginVia, supervisor: String? = nil, reason: String? = nil) {
        self.via = via
        self.supervisor = supervisor
        self.reason = reason
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(via, forKey: .via)
        try c.encode(supervisor, forKey: .supervisor)
        try c.encode(reason, forKey: .reason)
    }
}

/// One session row (from Core `SessionBriefEvent`).
public struct Session: Codable, Sendable, Hashable {
    public var id: String
    public var projectId: String?
    public var title: String
    public var status: SessionStatus
    /// "Turn N · one-line summary".
    public var summary: String?
    public var turnCount: UInt32?
    /// ISO 8601.
    public var lastActivityAt: String
    public var createdAt: String
    public var updatedAt: String
    public var pinned: Bool?
    public var hasUnread: Bool?
    public var origin: Origin?
    public var selectedLlmKey: String?
    public var selectedLlmDisplayName: String?
    /// Per-session override (`none` … `max`); `null` follows the model.
    public var reasoningEffort: String?

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(projectId, forKey: .projectId)
        try c.encode(title, forKey: .title)
        try c.encode(status, forKey: .status)
        try c.encode(summary, forKey: .summary)
        try c.encode(turnCount, forKey: .turnCount)
        try c.encode(lastActivityAt, forKey: .lastActivityAt)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(pinned, forKey: .pinned)
        try c.encode(hasUnread, forKey: .hasUnread)
        try c.encode(origin, forKey: .origin)
        try c.encode(selectedLlmKey, forKey: .selectedLlmKey)
        try c.encode(selectedLlmDisplayName, forKey: .selectedLlmDisplayName)
        try c.encode(reasoningEffort, forKey: .reasoningEffort)
    }
}

/// One project (from Core `ProjectBriefEvent`).
public struct Project: Codable, Sendable, Hashable {
    public var id: String
    public var name: String
    public var icon: String?
    public var color: String?
    public var pinned: Bool
    public var lastActivityAt: String
    public var createdAt: String
    public var updatedAt: String

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(icon, forKey: .icon)
        try c.encode(color, forKey: .color)
        try c.encode(pinned, forKey: .pinned)
        try c.encode(lastActivityAt, forKey: .lastActivityAt)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}

/// Live run state of one session (Core `RunState`; event
/// `session.runState`).
public struct SessionRunState: Codable, Sendable, Hashable {
    public var sessionId: String
    /// A runner process is up.
    public var runnerAlive: Bool
    /// Mid-turn (flickers false between turns of one run).
    public var agentRunning: Bool
    /// A run is open (steady across a multi-turn run).
    public var openRun: Bool
    public var queuedCount: UInt32
    /// The last run ended on an unanswered `ask_user` question.
    public var askPending: Bool
    /// `exitReason.result` of the last completed run, verbatim.
    public var lastExit: String?

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(runnerAlive, forKey: .runnerAlive)
        try c.encode(agentRunning, forKey: .agentRunning)
        try c.encode(openRun, forKey: .openRun)
        try c.encode(queuedCount, forKey: .queuedCount)
        try c.encode(askPending, forKey: .askPending)
        try c.encode(lastExit, forKey: .lastExit)
    }
}

/// Author of a message row (Core `MessageRole`).
public enum MessageRole: String, Codable, Sendable, Hashable, CaseIterable {
    case user, agent, system, unknown

    public init(from decoder: any Decoder) throws {
        self = try openEnum(decoder, unknown: .unknown)
    }
}

/// An `ask_user` question with its candidate answers.
public struct AskUser: Codable, Sendable, Hashable {
    public var question: String
    public var candidates: [String]
}

/// Per-answer usage (Core `MessageTelemetry`).
public struct MessageTelemetry: Codable, Sendable, Hashable {
    public var elapsedMs: Int64?
    public var inputTokens: Int64?
    public var outputTokens: Int64?
    public var cacheCreateTokens: Int64?
    public var cacheReadTokens: Int64?
    public var requestCount: Int64?
    public var contextUsedChars: Int64?
    public var contextLimitChars: Int64?

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(elapsedMs, forKey: .elapsedMs)
        try c.encode(inputTokens, forKey: .inputTokens)
        try c.encode(outputTokens, forKey: .outputTokens)
        try c.encode(cacheCreateTokens, forKey: .cacheCreateTokens)
        try c.encode(cacheReadTokens, forKey: .cacheReadTokens)
        try c.encode(requestCount, forKey: .requestCount)
        try c.encode(contextUsedChars, forKey: .contextUsedChars)
        try c.encode(contextLimitChars, forKey: .contextLimitChars)
    }
}

/// A file attached to a message; bytes come from `attachment.read`.
public struct Attachment: Codable, Sendable, Hashable {
    public var id: String
    public var messageId: String
    public var sessionId: String
    /// `image` today.
    public var kind: String
    public var mimeType: String
    public var byteSize: UInt64
    public var width: UInt32?
    public var height: UInt32?
    public var createdAt: String

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(messageId, forKey: .messageId)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(kind, forKey: .kind)
        try c.encode(mimeType, forKey: .mimeType)
        try c.encode(byteSize, forKey: .byteSize)
        try c.encode(width, forKey: .width)
        try c.encode(height, forKey: .height)
        try c.encode(createdAt, forKey: .createdAt)
    }
}

/// One visible conversation row (from Core `PersistedMessageRow` or
/// `MessageBrief`; fields one source lacks are `null`).
public struct Message: Codable, Sendable, Hashable {
    public var id: String
    public var sessionId: String
    public var role: MessageRole
    public var content: String
    public var turnIndex: Int64?
    public var sequence: Int64?
    public var finalAnswer: String?
    public var summary: String?
    public var thinking: String?
    public var preamble: String?
    /// The runner's tool calls, passed through untyped (design §6.6).
    public var toolCalls: JSONValue?
    /// Same for the tool results.
    public var toolResults: JSONValue?
    public var askUser: AskUser?
    public var telemetry: MessageTelemetry?
    public var goalId: String?
    public var origin: Origin?
    public var attachments: [Attachment]
    public var createdAt: String

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(role, forKey: .role)
        try c.encode(content, forKey: .content)
        try c.encode(turnIndex, forKey: .turnIndex)
        try c.encode(sequence, forKey: .sequence)
        try c.encode(finalAnswer, forKey: .finalAnswer)
        try c.encode(summary, forKey: .summary)
        try c.encode(thinking, forKey: .thinking)
        try c.encode(preamble, forKey: .preamble)
        try c.encode(toolCalls, forKey: .toolCalls)
        try c.encode(toolResults, forKey: .toolResults)
        try c.encode(askUser, forKey: .askUser)
        try c.encode(telemetry, forKey: .telemetry)
        try c.encode(goalId, forKey: .goalId)
        try c.encode(origin, forKey: .origin)
        try c.encode(attachments, forKey: .attachments)
        try c.encode(createdAt, forKey: .createdAt)
    }
}

/// A queued (not yet persisted) user message.
public struct QueuedMessage: Codable, Sendable, Hashable {
    /// Queue-local id, not a message id.
    public var queueId: String
    public var text: String
    public var queuedAt: String
}
