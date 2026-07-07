import type { MessageRow } from "@/types/db";
import type { Session } from "@/types/session";

export function makeSession(overrides: Partial<Session> = {}): Session {
  const now = "2026-06-18T08:00:00.000Z";
  return {
    id: "s-test",
    title: "新对话",
    status: "idle",
    errorCount: 0,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    runtimeKind: "external",
    runtimeLabel: "外部 GA",
    gaRuntimeKind: "external",
    ...overrides,
  };
}

export function makeMessageRow(overrides: Partial<MessageRow>): MessageRow {
  const role = overrides.role ?? "user";
  const turnIndex = overrides.turn_index ?? 1;
  const sequence =
    overrides.sequence ?? (role === "assistant" ? 1 : role === "tool" ? 2 : 0);
  return {
    id: `msg_${turnIndex}_${sequence}_${role}`,
    session_id: "s-test",
    turn_index: turnIndex,
    sequence,
    role,
    content: "",
    tool_calls: null,
    tool_results: null,
    thinking: null,
    final_answer: null,
    summary: null,
    preamble: null,
    created_via: null,
    supervisor: null,
    origin_note: null,
    visibility: "visible",
    telemetry: null,
    goal_id: null,
    attachments: [],
    created_at: "2026-06-18T08:00:00.000Z",
    ...overrides,
  };
}
