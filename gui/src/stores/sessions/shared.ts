import type { StateCreator } from "zustand";

// Cross-store statics: runtime.ts and messages.ts both import the
// sessions store statically too, forming a cycle. The pattern is safe
// in Vite / ES modules as long as accesses happen at action-body time
// rather than module evaluation time — exactly the case here
// (everything is `useFooStore.getState()` inside an async action).
import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import { toDurableStatus } from "@/lib/sessions";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { Origin } from "@/types/conversation";
import type {
  Project,
  RuntimeKind,
  Session,
  SessionStatus,
} from "@/types/session";

// The four slice interfaces are imported type-only: the runtime import
// direction is strictly slice → shared, so this is erased and no
// runtime cycle exists.
import type { SessionArchiveSlice } from "./archive-slice";
import type { SessionHydrateSlice } from "./hydrate-slice";
import type { SessionLifecycleSlice } from "./lifecycle-slice";
import type { SessionProjectSlice } from "./project-slice";

// ---------------- store composition ----------------

export type SessionsStore = SessionLifecycleSlice &
  SessionArchiveSlice &
  SessionProjectSlice &
  SessionHydrateSlice;

/**
 * All slices share the full store's `(set, get)` — cross-domain writes
 * (deleteProject touching sessions, emptyArchive calling the bulk
 * delete, activateSession reading projects) stay ordinary `get()`
 * calls, which is why the split lives inside one `create()` rather
 * than separate stores.
 */
export type SessionsSliceCreator<T> = StateCreator<SessionsStore, [], [], T>;

/** Merged state shape, kept for `Partial<SessionsState>` return-object
 * typing inside actions that patch across slice-owned fields. */
export interface SessionsState {
  sessions: Session[];
  activeSessionId: string | undefined;
  projects: Project[];
  activeProjectFilter: string | undefined;
}

// ---------------- wire types ----------------

// Mirror of Rust `SessionBrief` (see core/src/api/session.rs) — only
// the durable fields that ship over the Tauri invoke wire. The GUI's
// `Session` type adds runtime-only fields (pid, currentTool,
// pendingApprovalCount, etc.) that this slice initialises to defaults.
export interface SessionBriefWire {
  id: string;
  projectId?: string;
  title: string;
  status: SessionStatus;
  summary?: string;
  turnCount?: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  hasUnread?: boolean;
  origin?: Origin;
  approvalMode?: "auto" | "approval" | null;
  selectedLlmIndex?: number;
  selectedLlmKey?: string;
  selectedLlmDisplayName?: string;
  runtimeKind?: RuntimeKind;
  runtimeLabel?: string;
  gaRuntimeKind?: RuntimeKind;
  gaRuntimeId?: string;
  promptProfile?: string;
}

// Mirror of Rust `ProjectBrief`.
export interface ProjectBriefWire {
  id: string;
  name: string;
  rootPath?: string;
  workspaceEnabled?: boolean;
  icon?: string;
  color?: string;
  pinned: boolean;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

// Mirror of Rust `Origin`. GUI writes use `via: "gui"`; supervisor /
// system writes (B4) build their own. Created at module top so every
// invoke can share the same instance.
export const GUI_ORIGIN = { via: "gui" } as const;
export const MANAGED_PROMPT_PROFILE = "galley-persona-v1";

// ---------------- helpers (slice-private plumbing) ----------------

export function currentCopy() {
  return copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  );
}

export function pushDeleteFailedToast(context: string, error: unknown) {
  const copy = currentCopy();
  useUiStore.getState().pushToast(
    makeAppError({
      category: "business",
      severity: "error",
      title: copy.toasts.deleteFailed,
      message: copy.toasts.deleteFailedMessage,
      hint: null,
      retryable: false,
      context,
      traceback: errorMessage(error),
    }),
  );
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export function sessionFromBrief(b: SessionBriefWire): Session {
  const gaRuntimeKind = b.gaRuntimeKind ?? "external";
  return {
    id: b.id,
    projectId: b.projectId,
    title: b.title,
    // Collapse any stale runtime status from Core's persisted column to
    // the durable subset — the row never holds a live status; that's
    // derived at read time (see useSessionStatusView).
    status: toDurableStatus(b.status),
    summary: b.summary,
    turnCount: b.turnCount ?? 0,
    errorCount: 0,
    currentTool: undefined,
    pid: undefined,
    cwd: undefined,
    pinned: b.pinned ?? false,
    hasUnread: b.hasUnread ?? false,
    origin: b.origin,
    approvalMode: b.approvalMode ?? null,
    lastActivityAt: b.lastActivityAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    selectedLlmIndex: b.selectedLlmIndex,
    selectedLlmKey: b.selectedLlmKey,
    selectedLlmDisplayName: b.selectedLlmDisplayName,
    runtimeKind: b.runtimeKind ?? gaRuntimeKind,
    runtimeLabel:
      b.runtimeLabel ?? (gaRuntimeKind === "managed" ? "内置内核" : "外部 GA"),
    gaRuntimeKind,
    gaRuntimeId: b.gaRuntimeId,
    promptProfile: b.promptProfile,
  };
}

export function briefRuntimeKind(b: SessionBriefWire): RuntimeKind {
  return b.gaRuntimeKind ?? "external";
}

export function projectFromBrief(b: ProjectBriefWire): Project {
  return {
    id: b.id,
    name: b.name,
    rootPath: b.rootPath,
    workspaceEnabled: b.workspaceEnabled ?? false,
    icon: b.icon,
    color: b.color,
    pinned: b.pinned,
    lastActivityAt: b.lastActivityAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/**
 * Update one session in `sessions` by id. Falls through to the
 * original array if the id isn't found — caller decides whether that
 * is a bug to surface or a silently-tolerable race.
 */
export function patchSessionInList(
  sessions: Session[],
  sid: string,
  patch: Partial<Session> | ((s: Session) => Session),
): { sessions: Session[]; changed: boolean } {
  const idx = sessions.findIndex((s) => s.id === sid);
  if (idx === -1) return { sessions, changed: false };
  const next = sessions.slice();
  const old = sessions[idx];
  next[idx] = typeof patch === "function" ? patch(old) : { ...old, ...patch };
  return { sessions: next, changed: true };
}

/**
 * Cross-store cleanup: drop a session's per-session conversation
 * state from messagesStore. Used by delete + bulk delete. The runtime
 * slot in `useRuntimeStore.byId[sid]` keeps the bridgeStatus around
 * for forensics (closed / error) — it gets garbage-collected the
 * next time the session id is reused.
 */
export function clearSessionMessages(sid: string): void {
  useMessagesStore.getState().clearSessionMessages(sid);
}
