import { create } from "zustand";

/**
 * B3 M4b · sessionsStore — authoritative session/project list slice.
 *
 * Writes go through the Rust `GalleyApi` trait via Tauri invoke (see
 * `core/src/api.rs`); the front-end keeps an in-memory mirror so the
 * sidebar / TopBar / Composer can render synchronously. The slice
 * intentionally optimistic-updates low-risk organization changes:
 * mutate in memory immediately, fire invoke fire-and-forget, log on
 * failure. Permanent delete is the exception because a failed DB delete
 * must not look successful to the user.
 *
 * This file does NOT own:
 *   - Per-session conversation state (turns / pending approvals /
 *     ask_user / in-flight streaming) — messagesStore (B3 M5).
 *   - Bridge lifecycle (status / pid / errors) — runtimeStore (M3b).
 *   - LLM list + per-session selected LLM — runtimeStore (M3a/b);
 *     the *persisted* row column is set via `setSessionLlm` here
 *     which routes through the Rust `set_session_llm` trait method.
 *
 * Cross-store reach after M5:
 *   - Live session status is NOT stored here; each sidebar row derives
 *     it at read time from the messages + runtime slices via
 *     `useSessionStatusView` (replaced the old fireSessionMirror push).
 *     `sessionFromBrief` collapses any stale runtime status from Core to
 *     the durable subset via `toDurableStatus`.
 *   - `clearSessionMessages` (shared helper) drops a session's
 *     conversation entry from messagesStore on delete + bulk delete.
 *   - `activateSession` orchestrates messagesStore.ensureMessages +
 *     restoreSessionTurns + runtimeStore.spawnBridge.
 *
 * The store body lives in `sessions/` as four StateCreator slices
 * sharing one `create()` — cross-domain writes (deleteProject touching
 * sessions, emptyArchive calling the bulk delete, activateSession
 * reading projects) keep working through the shared `(set, get)`:
 *   - lifecycle-slice: sessions + activeSessionId, create/activate/
 *     rename/pin/approval/LLM/title + external session mirrors
 *   - archive-slice:   archive/unarchive/delete, single + bulk
 *   - project-slice:   projects + activeProjectFilter + external
 *     project mirrors
 *   - hydrate-slice:   cold-start load of both domains
 */

import { createSessionArchiveSlice } from "./sessions/archive-slice";
import { createSessionHydrateSlice } from "./sessions/hydrate-slice";
import { createSessionLifecycleSlice } from "./sessions/lifecycle-slice";
import { createSessionProjectSlice } from "./sessions/project-slice";
import type { SessionsStore } from "./sessions/shared";

export type { SessionsStore } from "./sessions/shared";
export { DEFAULT_NEW_SESSION_TITLE } from "./sessions/lifecycle-slice";

export const useSessionsStore = create<SessionsStore>()((...a) => ({
  ...createSessionLifecycleSlice(...a),
  ...createSessionArchiveSlice(...a),
  ...createSessionProjectSlice(...a),
  ...createSessionHydrateSlice(...a),
}));
