import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

// Cross-store statics: runtime.ts and messages.ts both import this
// module statically too, forming a cycle. The pattern is safe in
// Vite / ES modules as long as accesses happen at action-body time
// rather than module evaluation time — exactly the case here
// (everything is `useFooStore.getState()` inside an async action).
import {
  currentLLMDisplayName,
  managedModelsToLLMs,
} from "@/lib/managed-model-options";
import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import { logPerf, perfNow } from "@/lib/perf";
import { useManagedModelsStore } from "@/stores/managed-models";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import type { LLMOption } from "@/stores/runtime";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { Origin } from "@/types/conversation";
import type {
  Project,
  RuntimeKind,
  Session,
  SessionStatus,
} from "@/types/session";

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
 *   - `applyDerivedFromRuntime` is called by messagesStore's
 *     `fireSessionMirror` to keep `status` / `pendingApprovalCount` /
 *     `hasPendingAskUser` on the session row in sync with the live
 *     conversation state.
 *   - `clearSessionMessages` (local helper) drops a session's
 *     conversation entry from messagesStore on delete + bulk delete.
 *   - `activateSession` orchestrates messagesStore.ensureMessages +
 *     restoreSessionTurns + runtimeStore.spawnBridge.
 */

// ---------------- types ----------------

// Mirror of Rust `SessionBrief` (see core/src/api/session.rs) — only
// the durable fields that ship over the Tauri invoke wire. The GUI's
// `Session` type adds runtime-only fields (pid, currentTool,
// pendingApprovalCount, etc.) that this slice initialises to defaults.
interface SessionBriefWire {
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
interface ProjectBriefWire {
  id: string;
  name: string;
  rootPath?: string;
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
const GUI_ORIGIN = { via: "gui" } as const;
const MANAGED_PROMPT_PROFILE = "galley-persona-v1";

function currentCopy() {
  return copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  );
}

function pushDeleteFailedToast(context: string, error: unknown) {
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

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

// Mirror of Rust `CreateSessionInput`.
interface CreateSessionInputWire {
  id: string;
  title: string;
  projectId?: string;
  selectedLlmIndex?: number;
  selectedLlmKey?: string;
  selectedLlmDisplayName?: string;
  gaRuntimeKind?: RuntimeKind;
  gaRuntimeId?: string;
  promptProfile?: string;
}

interface CreateProjectInputWire {
  id: string;
  name: string;
  rootPath?: string;
  icon?: string;
  color?: string;
}

interface LlmSelectionSnapshot {
  index: number;
  key: string;
  displayName: string;
}

// ---------------- helpers (private) ----------------

/**
 * Safety cap for auto-derived persisted titles. Sidebar rows decide visible
 * width with CSS truncation, so keep enough source text for wide sidebars while
 * avoiding unbounded prompt-sized titles in rename/search surfaces.
 */
const TITLE_DERIVE_MAX = 80;

function deriveTitleFromText(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= TITLE_DERIVE_MAX) return oneLine;
  return oneLine.slice(0, TITLE_DERIVE_MAX) + "…";
}

async function invokeHydrate<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  let lastError: unknown;
  for (const delayMs of [0, 250, 750]) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
    }
    try {
      return await invoke<T>(command, args);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** "新对话" — seed title set by `createSession`. */
export const DEFAULT_NEW_SESSION_TITLE = "新对话";

function runtimeLabelFallback(kind: RuntimeKind): string {
  switch (kind) {
    case "managed":
      return "内置 GA";
    case "external":
      return "外部 GA";
    case "galley_native":
      return "Galley Native";
  }
}

function sessionFromBrief(b: SessionBriefWire): Session {
  const gaRuntimeKind = b.gaRuntimeKind ?? "external";
  return {
    id: b.id,
    projectId: b.projectId,
    title: b.title,
    status: b.status,
    summary: b.summary,
    turnCount: b.turnCount ?? 0,
    pendingApprovalCount: 0,
    errorCount: 0,
    currentTool: undefined,
    pid: undefined,
    cwd: undefined,
    pinned: b.pinned ?? false,
    hasUnread: b.hasUnread ?? false,
    origin: b.origin,
    lastActivityAt: b.lastActivityAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    selectedLlmIndex: b.selectedLlmIndex,
    selectedLlmKey: b.selectedLlmKey,
    selectedLlmDisplayName: b.selectedLlmDisplayName,
    runtimeKind: b.runtimeKind ?? gaRuntimeKind,
    runtimeLabel: b.runtimeLabel ?? runtimeLabelFallback(gaRuntimeKind),
    gaRuntimeKind,
    gaRuntimeId: b.gaRuntimeId,
    promptProfile: b.promptProfile,
  };
}

function briefRuntimeKind(b: SessionBriefWire): RuntimeKind {
  return b.gaRuntimeKind ?? "external";
}

function projectFromBrief(b: ProjectBriefWire): Project {
  return {
    id: b.id,
    name: b.name,
    rootPath: b.rootPath,
    icon: b.icon,
    color: b.color,
    pinned: b.pinned,
    lastActivityAt: b.lastActivityAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function llmStableKey(llm: LLMOption): string {
  return llm.key ?? llm.name ?? llm.displayName;
}

function currentSelectionFromLLMs(
  llms: LLMOption[] | undefined,
): LlmSelectionSnapshot | undefined {
  const current = llms?.find((llm) => llm.isCurrent);
  if (!current) return undefined;
  const key = llmStableKey(current).trim();
  if (!key) return undefined;
  const displayName = current.displayName.trim() || key;
  return { index: current.index, key, displayName };
}

function currentLLMSelectionForNewSession(
  runtimeKind: RuntimeKind,
  activeSessionId: string | undefined,
): LlmSelectionSnapshot | undefined {
  const runtimeState = useRuntimeStore.getState();
  if (runtimeKind === "managed") {
    return currentSelectionFromLLMs(
      managedModelsToLLMs(
        useManagedModelsStore.getState().models,
        runtimeState.pendingLLMIndex,
      ),
    );
  }
  return currentSelectionFromLLMs(
    activeSessionId
      ? (runtimeState.byId[activeSessionId]?.llms ?? runtimeState.cachedLLMs)
      : runtimeState.cachedLLMs,
  );
}

/**
 * Update one session in `sessions` by id. Falls through to the
 * original array if the id isn't found — caller decides whether that
 * is a bug to surface or a silently-tolerable race.
 */
function patchSessionInList(
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
function clearSessionMessages(sid: string): void {
  useMessagesStore.getState().clearSessionMessages(sid);
}

// ---------------- store shape ----------------

interface SessionsState {
  sessions: Session[];
  activeSessionId: string | undefined;
  projects: Project[];
  activeProjectFilter: string | undefined;
}

interface SessionsActions {
  // ---- session list mutations ----
  setActiveSession: (id: string | undefined) => void;
  /**
   * Orchestrator: refresh the active session pointer, lazy-init the
   * runtime + messages slots, restore SQLite turns on first touch,
   * and auto-spawn the bridge when the session has no live one.
   *
   * Spans three slices (sessions / runtime / messages) — kept here
   * because sessionsStore owns the active id and is the natural
   * entry point for "switch to this session" UX events.
   *
   * Reads `prefsStore.gaConfig` for the spawn args.
   */
  activateSession: (id: string) => Promise<void>;
  /** Synchronous create — returns the new id for chaining. Rust write
   * happens fire-and-forget; in-memory state updates immediately. */
  createSession: (projectId?: string) => string;
  /** Create and await the Rust row. Used when another Core command must
   * reference the session immediately, such as desktop Goal master launch. */
  createSessionPersisted: (projectId?: string, title?: string) => Promise<string>;
  archiveSession: (sessionId: string) => void;
  unarchiveSession: (sessionId: string) => void;
  renameSession: (sessionId: string, newTitle: string) => void;
  togglePinSession: (sessionId: string) => void;
  deleteSessionPermanently: (sessionId: string) => Promise<void>;
  archiveSessionsBulk: (sessionIds: string[]) => void;
  unarchiveSessionsBulk: (sessionIds: string[]) => void;
  deleteSessionsPermanentlyBulk: (sessionIds: string[]) => Promise<void>;
  emptyArchive: () => Promise<number>;
  /** Server-side bump on turn_end. Optimistic in-memory update +
   * fire-and-forget invoke. Callers decide whether this turn is user-visible
   * enough to mark unread; intermediate agent-loop steps should only update
   * progress. */
  bumpSessionAfterTurn: (
    sessionId: string,
    summary?: string,
    stepNumber?: number,
    markUnread?: boolean,
  ) => void;
  /** Update the persisted per-session LLM choice. Called from
   * runtimeStore.replaceLLMs whenever a bridge picks a current LLM. */
  setSessionLlm: (
    sessionId: string,
    index: number,
    key: string,
    displayName: string,
  ) => Promise<void>;

  // ---- projects ----
  createProject: (input: {
    name: string;
    rootPath?: string;
  }) => Promise<Project>;
  updateProject: (
    id: string,
    partial: Partial<Pick<Project, "name" | "rootPath" | "pinned">>,
  ) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  assignSessionToProject: (
    sessionId: string,
    projectId: string | null,
  ) => Promise<void>;
  setActiveProjectFilter: (projectId: string | undefined) => void;

  // ---- runtime-driven mirroring (cross-store entry point) ----
  /**
   * Sync sidebar-visible fields (status / pendingApprovalCount /
   * hasPendingAskUser) onto the session row from the live
   * conversation state. Called from messagesStore.fireSessionMirror
   * after every conversation-side write.
   *
   * No-op when the patch matches the current row.
   */
  applyDerivedFromRuntime: (
    sessionId: string,
    patch: Partial<
      Pick<Session, "status" | "pendingApprovalCount" | "hasPendingAskUser">
    >,
  ) => void;
  /**
   * Used by messagesStore.appendUserTurn / appendUserTurnExternal on
   * the first user message in a fresh session: if the title is still
   * the seed placeholder, auto-derive from the message text. Server
   * write is fire-and-forget.
   *
   * No-op when the title has already been edited or the text trims to
   * empty. Returns the new title for the caller to log / scroll-snap.
   */
  maybeDeriveTitle: (sessionId: string, text: string) => string | null;
  /**
   * Used by IPC turn_end handler to refresh `lastStepIndex` on the
   * session row. In-memory only — transient field, not persisted (see
   * Session.lastStepIndex doc).
   */
  setLastStepIndex: (sessionId: string, step: number) => void;

  // ---- B4 M1 · external mirror entry points ----
  //
  // CLI / supervisor writes go through Galley Core's socket transport,
  // which writes the SQLite row and then emits a Tauri event to notify
  // the GUI. These actions are the listener-side mirrors: they update
  // in-memory state to match the row that's already on disk, **without**
  // invoking a Rust command back (the row is already correct). Mirror of
  // `appendUserTurnExternal` over in messagesStore.

  /** Insert a freshly-created (CLI / supervisor) session into the list.
   * No-op if a row with the same id is already present — covers the
   * narrow race where the GUI created it itself and the external event
   * arrives second. */
  applyExternalSessionCreated: (brief: SessionBriefWire) => void;
  /** Patch the in-memory row from `session.archive` / `session.restore` /
   * `session.move` / `llm.set` (`session-updated-external`) socket
   * emits. No-op if the id isn't known yet (will land via
   * `applyExternalSessionCreated` first). */
  applyExternalSessionUpdated: (brief: SessionBriefWire) => void;
  /** Insert a CLI / supervisor-created project. Merge-replaces if the
   * GUI just created the same id locally. */
  applyExternalProjectCreated: (brief: ProjectBriefWire) => void;
  /** Mirror the FK SET NULL detach: drops the project row + nulls
   * `projectId` on any sessions that were attached to it. Clears the
   * active filter if it pointed at this project. */
  applyExternalProjectDeleted: (projectId: string) => void;

  // ---- hydrate ----
  /** Load sessions + projects from Rust core. Called by the cold-start
   * orchestrator at `lib/hydrate.ts`. Mutates state directly; errors
   * are logged but don't throw — start-empty is a recoverable cold path. */
  hydrate: () => Promise<void>;
}

export type SessionsStore = SessionsState & SessionsActions;

// ---------------- store ----------------

export const useSessionsStore = create<SessionsStore>((set, get) => ({
  sessions: [],
  activeSessionId: undefined,
  projects: [],
  activeProjectFilter: undefined,

  // ---- session list mutations ----

  setActiveSession: (id) => {
    let toClear: string | null = null;
    set((state) => {
      if (!id) return { activeSessionId: undefined };
      const idx = state.sessions.findIndex((s) => s.id === id);
      if (idx === -1) return { activeSessionId: id };
      const row = state.sessions[idx];
      if (row.hasUnread) {
        const sessions = state.sessions.slice();
        sessions[idx] = { ...row, hasUnread: false };
        toClear = id;
        return { activeSessionId: id, sessions };
      }
      return { activeSessionId: id };
    });
    if (toClear) {
      void invoke("clear_session_unread", { id: toClear }).catch((e) => {
        console.debug("[sessions] clear_session_unread failed.", e);
      });
    }
  },

  activateSession: async (id) => {
    const activateStartedAt = perfNow();
    // Step 1: refresh the active session pointer (clears unread on
    // the row via Rust + sets activeSessionId).
    get().setActiveSession(id);
    const session = get().sessions.find((s) => s.id === id);
    // Step 2: lazy-init the runtime entry — LLM seed comes from the
    // session row's persisted choice + the active runtime's own model
    // list. Managed sessions must not seed from the external GA cache.
    const runtimeStore = useRuntimeStore.getState();
    const runtimeKind =
      session?.gaRuntimeKind ?? usePrefsStore.getState().activeRuntimeKind;
    const managedSeedLLMs =
      runtimeKind === "managed"
        ? managedModelsToLLMs(useManagedModelsStore.getState().models)
        : undefined;
    runtimeStore.ensureRuntime(id, {
      persistedIndex: session?.selectedLlmIndex,
      persistedKey: session?.selectedLlmKey,
      persistedDisplayName:
        runtimeKind === "managed" ? undefined : session?.selectedLlmDisplayName,
      cachedLLMs: managedSeedLLMs ?? runtimeStore.cachedLLMs,
      cachedDisplayName:
        runtimeKind === "managed"
          ? currentLLMDisplayName(managedSeedLLMs ?? [])
          : runtimeStore.cachedLLMDisplayName,
    });
    // Step 3: lazy-init the messages entry for this session.
    const messagesStore = useMessagesStore.getState();
    messagesStore.ensureMessages(id);
    // Step 4: restore conversation turns from SQLite on first touch
    // in this app instance. `byId[id].turns.length === 0` is a safe
    // proxy for "fresh runtime" — once IPC starts streaming, even an
    // empty SQLite history won't keep turns at zero.
    const msgs = useMessagesStore.getState().byId[id];
    const looksFresh = !msgs || msgs.turns.length === 0;
    const hasHistory = (session?.turnCount ?? 0) > 0;
    if (looksFresh && hasHistory) {
      const restoreStartedAt = perfNow();
      try {
        await messagesStore.restoreSessionTurns(id);
      } catch (e) {
        console.warn(
          "[sessions] activateSession restoreSessionTurns failed.",
          e,
        );
      } finally {
        logPerf("sessions.activateSession.restore", restoreStartedAt, {
          sessionId: id,
          turnCount: session?.turnCount ?? 0,
        });
      }
    }
    // Step 5: auto-spawn the bridge when this session has no live
    // one. Re-spawn on `closed` / `error` lets a kill or crash
    // recover by simply re-clicking the session. `closed` is also
    // how the LRU governor signals "suspended" — re-activation
    // regenerates the bridge and the IPC `ready` handler replays
    // SQLite history.
    const bridgeStatus =
      useRuntimeStore.getState().byId[id]?.bridgeStatus ?? "idle";
    const hasBridgeClient = useRuntimeStore.getState().hasBridgeClient(id);
    const needsSpawn =
      bridgeStatus === "idle" ||
      bridgeStatus === "closed" ||
      bridgeStatus === "error" ||
      (bridgeStatus === "connected" && !hasBridgeClient);
    if (needsSpawn) {
      // Project = pure grouping. We deliberately do NOT inject the
      // project's rootPath as the bridge cwd here — doing so would
      // chdir away from the GA install dir and silently break GA's
      // relative `./memory/...` reads (memory_management_sop, any
      // user SOP, etc.). See devlog 2026-05-14 rootPath rollback.
      //
      // EmptyState's inline LLM picker stashes `pendingLLMIndex`
      // because there was no live bridge to set_llm against. Apply
      // it here only when the session is genuinely fresh. Otherwise
      // use the session row's own persisted choice. Always clear
      // pending after this activation so an abandoned pick (user
      // picked LLM, then clicked an existing session) doesn't leak
      // into a later unrelated spawn.
      const runtimeStoreSnap = useRuntimeStore.getState();
      const pendingLLMIndex = runtimeStoreSnap.pendingLLMIndex;
      const msgsNow = useMessagesStore.getState().byId[id];
      const isFreshSession =
        (session?.turnCount ?? 0) === 0 &&
        (!msgsNow || msgsNow.turns.length === 0);
      const consumePending = isFreshSession && pendingLLMIndex !== undefined;
      if (pendingLLMIndex !== undefined) {
        useRuntimeStore.setState({ pendingLLMIndex: undefined });
      }
      // Restore the persisted LLM choice on spawn. Without this a
      // fresh session created after the user switched models still
      // boots the bridge with mykey.py's default, and a respawned
      // historical session loses its own `set_llm` history. Pending
      // pick (Empty State LLM picker) wins when present because the
      // user just made a fresh choice.
      const restoredLlmIndex =
        !consumePending && !session?.selectedLlmKey
          ? session?.selectedLlmIndex
          : undefined;
      const restoredLlmKey = !consumePending
        ? session?.selectedLlmKey
        : undefined;
      // prefsStore is a leaf in the slice DAG (AD-09) — no cycle
      // concern with the cross-store static import block at the
      // top of this file.
      const gaConfig = usePrefsStore.getState().gaConfig;
      const spawnStartedAt = perfNow();
      await useRuntimeStore.getState().spawnBridge({
        ...gaConfig,
        sessionId: id,
        cwd: undefined,
        llmIndex: consumePending ? pendingLLMIndex : restoredLlmIndex,
        llmKey: consumePending ? session?.selectedLlmKey : restoredLlmKey,
        runtimeKind,
      });
      logPerf("sessions.activateSession.spawnBridge", spawnStartedAt, {
        sessionId: id,
        runtimeKind,
      });
    }
    logPerf("sessions.activateSession", activateStartedAt, {
      sessionId: id,
      hasHistory,
      needsSpawn,
    });
    // Already alive — runtimeStore.spawnBridge internally LRU-touches
    // on each call, so the alive-bridge branch is now a no-op here.
  },

  createSession: (projectId) => {
    const id = `s-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const now = new Date().toISOString();
    const gaRuntimeKind = usePrefsStore.getState().activeRuntimeKind;
    const llmSelection = currentLLMSelectionForNewSession(
      gaRuntimeKind,
      get().activeSessionId,
    );
    const promptProfile =
      gaRuntimeKind === "managed" ? MANAGED_PROMPT_PROFILE : undefined;
    const newSession: Session = {
      id,
      title: DEFAULT_NEW_SESSION_TITLE,
      status: "idle",
      projectId,
      pendingApprovalCount: 0,
      errorCount: 0,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      runtimeKind: gaRuntimeKind,
      runtimeLabel: runtimeLabelFallback(gaRuntimeKind),
      gaRuntimeKind,
      promptProfile,
      selectedLlmIndex: llmSelection?.index,
      selectedLlmKey: llmSelection?.key,
      selectedLlmDisplayName: llmSelection?.displayName,
    };
    set((state) => ({
      sessions: [newSession, ...state.sessions],
      activeSessionId: id,
    }));
    void invoke("create_session", {
      input: {
        id,
        title: DEFAULT_NEW_SESSION_TITLE,
        projectId,
        selectedLlmIndex: llmSelection?.index,
        selectedLlmKey: llmSelection?.key,
        selectedLlmDisplayName: llmSelection?.displayName,
        gaRuntimeKind,
        promptProfile,
      } as CreateSessionInputWire,
      origin: GUI_ORIGIN,
    }).catch((e) => {
      console.debug("[sessions] create_session invoke failed.", e);
    });
    return id;
  },

  createSessionPersisted: async (projectId, title) => {
    const id = `s-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const now = new Date().toISOString();
    const gaRuntimeKind = usePrefsStore.getState().activeRuntimeKind;
    const llmSelection = currentLLMSelectionForNewSession(
      gaRuntimeKind,
      get().activeSessionId,
    );
    const promptProfile =
      gaRuntimeKind === "managed" ? MANAGED_PROMPT_PROFILE : undefined;
    const sessionTitle = title?.trim() || DEFAULT_NEW_SESSION_TITLE;
    const newSession: Session = {
      id,
      title: sessionTitle,
      status: "idle",
      projectId,
      pendingApprovalCount: 0,
      errorCount: 0,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      runtimeKind: gaRuntimeKind,
      runtimeLabel: runtimeLabelFallback(gaRuntimeKind),
      gaRuntimeKind,
      promptProfile,
      selectedLlmIndex: llmSelection?.index,
      selectedLlmKey: llmSelection?.key,
      selectedLlmDisplayName: llmSelection?.displayName,
    };
    set((state) => ({
      sessions: [newSession, ...state.sessions],
      activeSessionId: id,
    }));
    try {
      await invoke("create_session", {
        input: {
          id,
          title: sessionTitle,
          projectId,
          selectedLlmIndex: llmSelection?.index,
          selectedLlmKey: llmSelection?.key,
          selectedLlmDisplayName: llmSelection?.displayName,
          gaRuntimeKind,
          promptProfile,
        } as CreateSessionInputWire,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      set((state) => ({
        sessions: state.sessions.filter((session) => session.id !== id),
        activeSessionId:
          state.activeSessionId === id ? undefined : state.activeSessionId,
      }));
      throw e;
    }
    return id;
  },

  archiveSession: (sessionId) => {
    const now = new Date().toISOString();
    let archivedTitle: string | null = null;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          archivedTitle = s.title;
          return { ...s, status: "archived", updatedAt: now };
        },
      );
      if (!changed) return {};
      const out: Partial<SessionsState> = { sessions };
      if (state.activeSessionId === sessionId) {
        out.activeSessionId = undefined;
      }
      return out;
    });
    if (archivedTitle === null) return;
    void invoke("archive_session", { id: sessionId, origin: GUI_ORIGIN }).catch(
      (e) => console.debug("[sessions] archive_session invoke failed.", e),
    );
    // UX feedback: archiving makes the row vanish from the sidebar —
    // a short info toast confirms the action.
    const copy = currentCopy();
    useUiStore.getState().pushToast(
      makeAppError({
        category: "business",
        severity: "info",
        title: copy.toasts.archived,
        message: archivedTitle,
        hint: null,
        retryable: false,
        context: "archiveSession",
        traceback: null,
      }),
    );
  },

  unarchiveSession: (sessionId) => {
    const now = new Date().toISOString();
    let changedAny = false;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          if (s.status !== "archived") return s;
          changedAny = true;
          return { ...s, status: "idle", updatedAt: now };
        },
      );
      return changed ? { sessions } : {};
    });
    if (!changedAny) return;
    void invoke("unarchive_session", {
      id: sessionId,
      origin: GUI_ORIGIN,
    }).catch((e) =>
      console.debug("[sessions] unarchive_session invoke failed.", e),
    );
  },

  renameSession: (sessionId, newTitle) => {
    const cleaned = newTitle.trim();
    const finalTitle = cleaned === "" ? DEFAULT_NEW_SESSION_TITLE : cleaned;
    const now = new Date().toISOString();
    let changedAny = false;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          if (s.title === finalTitle) return s;
          changedAny = true;
          return { ...s, title: finalTitle, updatedAt: now };
        },
      );
      return changed ? { sessions } : {};
    });
    if (!changedAny) return;
    void invoke("rename_session", {
      id: sessionId,
      title: finalTitle,
      origin: GUI_ORIGIN,
    }).catch((e) =>
      console.debug("[sessions] rename_session invoke failed.", e),
    );
  },

  togglePinSession: (sessionId) => {
    const now = new Date().toISOString();
    let nextPinned: boolean | null = null;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          if (s.status === "archived") return s;
          nextPinned = !s.pinned;
          return { ...s, pinned: nextPinned, updatedAt: now };
        },
      );
      return changed ? { sessions } : {};
    });
    if (nextPinned === null) return;
    void invoke("set_session_pinned", {
      id: sessionId,
      pinned: nextPinned,
      origin: GUI_ORIGIN,
    }).catch((e) =>
      console.debug("[sessions] set_session_pinned invoke failed.", e),
    );
  },

  deleteSessionPermanently: async (sessionId) => {
    // Defensive: shut down any live bridge before yanking the row.
    // Archived sessions shouldn't have one (LRU 5 typically reaps),
    // but covering the edge so we don't leak a process pointing at
    // a deleted id.
    try {
      const { useRuntimeStore } = await import("@/stores/runtime");
      await useRuntimeStore.getState().shutdownBridge(sessionId);
    } catch (e) {
      console.warn(
        "[sessions] deleteSessionPermanently shutdownBridge failed.",
        e,
      );
    }
    try {
      await invoke("delete_session", { id: sessionId, origin: GUI_ORIGIN });
    } catch (e) {
      console.warn("[sessions] delete_session invoke failed.", e);
      pushDeleteFailedToast("deleteSessionPermanently", e);
      throw e;
    }
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== sessionId);
      const out: Partial<SessionsState> = { sessions };
      if (state.activeSessionId === sessionId) {
        out.activeSessionId = undefined;
      }
      return out;
    });
    clearSessionMessages(sessionId);
  },

  archiveSessionsBulk: (sessionIds) => {
    if (sessionIds.length === 0) return;
    const now = new Date().toISOString();
    const idSet = new Set(sessionIds);
    let archivedCount = 0;
    set((state) => {
      const sessions = state.sessions.map((s) => {
        if (!idSet.has(s.id) || s.status === "archived") return s;
        archivedCount++;
        return { ...s, status: "archived" as SessionStatus, updatedAt: now };
      });
      const out: Partial<SessionsState> = { sessions };
      if (state.activeSessionId && idSet.has(state.activeSessionId)) {
        out.activeSessionId = undefined;
      }
      return out;
    });
    if (archivedCount === 0) return;
    void invoke("bulk_archive_sessions", {
      ids: sessionIds,
      origin: GUI_ORIGIN,
    }).catch((e) =>
      console.debug("[sessions] bulk_archive_sessions invoke failed.", e),
    );
    const copy = currentCopy();
    useUiStore.getState().pushToast(
      makeAppError({
        category: "business",
        severity: "info",
        title: copy.toasts.archivedCount(archivedCount),
        message: "",
        hint: null,
        retryable: false,
        context: "archiveSessionsBulk",
        traceback: null,
      }),
    );
  },

  unarchiveSessionsBulk: (sessionIds) => {
    if (sessionIds.length === 0) return;
    const now = new Date().toISOString();
    const idSet = new Set(sessionIds);
    let unarchivedCount = 0;
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (!idSet.has(s.id) || s.status !== "archived") return s;
        unarchivedCount++;
        return { ...s, status: "idle" as SessionStatus, updatedAt: now };
      }),
    }));
    if (unarchivedCount === 0) return;
    void invoke("bulk_unarchive_sessions", {
      ids: sessionIds,
      origin: GUI_ORIGIN,
    }).catch((e) =>
      console.debug("[sessions] bulk_unarchive_sessions invoke failed.", e),
    );
  },

  deleteSessionsPermanentlyBulk: async (sessionIds) => {
    if (sessionIds.length === 0) return;
    // Sequential bridge teardown — racing N parallel shutdowns
    // against the same process tree caused flakiness in M3b dogfood.
    const { useRuntimeStore } = await import("@/stores/runtime");
    for (const id of sessionIds) {
      try {
        await useRuntimeStore.getState().shutdownBridge(id);
      } catch (e) {
        console.warn(
          `[sessions] deleteSessionsPermanentlyBulk shutdownBridge failed for ${id}.`,
          e,
        );
      }
    }
    try {
      await invoke("bulk_delete_sessions", {
        ids: sessionIds,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      console.warn("[sessions] bulk_delete_sessions invoke failed.", e);
      pushDeleteFailedToast("deleteSessionsPermanentlyBulk", e);
      throw e;
    }
    const idSet = new Set(sessionIds);
    set((state) => {
      const sessions = state.sessions.filter((s) => !idSet.has(s.id));
      const out: Partial<SessionsState> = { sessions };
      if (state.activeSessionId && idSet.has(state.activeSessionId)) {
        out.activeSessionId = undefined;
      }
      return out;
    });
    sessionIds.forEach((id) => clearSessionMessages(id));
  },

  emptyArchive: async () => {
    const archived = get().sessions.filter((s) => s.status === "archived");
    if (archived.length === 0) return 0;
    await get().deleteSessionsPermanentlyBulk(archived.map((s) => s.id));
    return archived.length;
  },

  bumpSessionAfterTurn: (sessionId, summary, stepNumber, markUnread = true) => {
    const now = new Date().toISOString();
    const becameUnread = markUnread && sessionId !== get().activeSessionId;
    let didUpdate = false;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          const turnCount = (s.turnCount ?? 0) + 1;
          // Truncate to keep the sidebar single-line. Mirrors the
          // Rust-side `truncate_summary` (80 + "…") used by the
          // invoke counterpart; both must agree or the in-memory and
          // persisted values diverge.
          const nextSummary =
            summary && summary.trim() ? truncateSummary(summary) : s.summary;
          return {
            ...s,
            turnCount,
            summary: nextSummary,
            lastStepIndex:
              typeof stepNumber === "number" && stepNumber > 0
                ? stepNumber
                : s.lastStepIndex,
            lastActivityAt: now,
            updatedAt: now,
            hasUnread: becameUnread ? true : s.hasUnread,
          };
        },
      );
      if (!changed) return {};
      didUpdate = true;
      return { sessions };
    });
    if (!didUpdate) return;
    void invoke("bump_session_after_turn", {
      id: sessionId,
      summary: summary ?? null,
      stepNumber: stepNumber ?? null,
      markUnread: becameUnread,
    }).catch((e) =>
      console.debug("[sessions] bump_session_after_turn invoke failed.", e),
    );
  },

  setSessionLlm: async (sessionId, index, key, displayName) => {
    let didUpdate = false;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          if (
            s.selectedLlmIndex === index &&
            s.selectedLlmKey === key &&
            s.selectedLlmDisplayName === displayName
          ) {
            return s;
          }
          didUpdate = true;
          return {
            ...s,
            selectedLlmIndex: index,
            selectedLlmKey: key,
            selectedLlmDisplayName: displayName,
          };
        },
      );
      return changed ? { sessions } : {};
    });
    if (!didUpdate) return;
    try {
      await invoke("set_session_llm", {
        id: sessionId,
        index,
        key,
        displayName,
      });
    } catch (e) {
      console.debug("[sessions] set_session_llm invoke failed.", e);
    }
  },

  // ---- projects ----

  createProject: async ({ name, rootPath }) => {
    const id = `proj_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const now = new Date().toISOString();
    const next: Project = {
      id,
      name: name.trim(),
      rootPath: rootPath?.trim() || undefined,
      pinned: false,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ projects: [next, ...state.projects] }));
    try {
      await invoke("create_project", {
        input: {
          id,
          name: next.name,
          rootPath: next.rootPath,
        } as CreateProjectInputWire,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      console.debug("[sessions] create_project invoke failed.", e);
    }
    return next;
  },

  updateProject: async (id, partial) => {
    const now = new Date().toISOString();
    let updated: Project | null = null;
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== id) return p;
        updated = {
          ...p,
          ...partial,
          rootPath:
            partial.rootPath !== undefined
              ? partial.rootPath?.trim() || undefined
              : p.rootPath,
          name: partial.name !== undefined ? partial.name.trim() : p.name,
          updatedAt: now,
        };
        return updated;
      }),
    }));
    if (!updated) return;
    try {
      // Translate front-end Partial<Project> into Rust ProjectPatch:
      //   - name: Option<String>           (single Option — empty rejected server-side)
      //   - root_path: Option<Option<String>>
      //   - pinned: Option<bool>
      //
      // Double-Option pattern lets `Some(null)` clear root_path vs
      // `null` (not set, leave alone). The GUI's `partial.rootPath`
      // signal is binary (string or undefined) — we map undefined → omitted,
      // empty/whitespace → Some(null), non-empty → Some(value).
      const patch: Record<string, unknown> = {};
      if (partial.name !== undefined) patch.name = partial.name.trim();
      if (Object.prototype.hasOwnProperty.call(partial, "rootPath")) {
        const trimmed = partial.rootPath?.trim();
        patch.rootPath = trimmed ? trimmed : null;
      }
      if (partial.pinned !== undefined) patch.pinned = partial.pinned;
      await invoke("update_project", {
        id,
        patch,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      console.debug("[sessions] update_project invoke failed.", e);
    }
  },

  deleteProject: async (id) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      // FK SET NULL on sessions.project_id; mirror in memory.
      sessions: state.sessions.map((s) =>
        s.projectId === id ? { ...s, projectId: undefined } : s,
      ),
      activeProjectFilter:
        state.activeProjectFilter === id
          ? undefined
          : state.activeProjectFilter,
    }));
    try {
      await invoke("delete_project", { id, origin: GUI_ORIGIN });
    } catch (e) {
      console.debug("[sessions] delete_project invoke failed.", e);
    }
  },

  assignSessionToProject: async (sessionId, projectId) => {
    const now = new Date().toISOString();
    let didUpdate = false;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          didUpdate = true;
          return { ...s, projectId: projectId ?? undefined, updatedAt: now };
        },
      );
      return changed ? { sessions } : {};
    });
    if (!didUpdate) return;
    try {
      await invoke("assign_session_to_project", {
        sessionId,
        projectId,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      console.debug("[sessions] assign_session_to_project invoke failed.", e);
    }
  },

  setActiveProjectFilter: (projectId) =>
    set({ activeProjectFilter: projectId }),

  // ---- runtime-driven mirroring ----

  applyDerivedFromRuntime: (sessionId, patch) => {
    set((state) => {
      const idx = state.sessions.findIndex((s) => s.id === sessionId);
      if (idx === -1) return {};
      const s = state.sessions[idx];
      const newStatus = patch.status ?? s.status;
      const newCount = patch.pendingApprovalCount ?? s.pendingApprovalCount;
      const newAsk = patch.hasPendingAskUser ?? s.hasPendingAskUser ?? false;
      if (
        s.status === newStatus &&
        s.pendingApprovalCount === newCount &&
        (s.hasPendingAskUser ?? false) === newAsk
      ) {
        return {};
      }
      const sessions = state.sessions.slice();
      sessions[idx] = {
        ...s,
        status: newStatus,
        pendingApprovalCount: newCount,
        hasPendingAskUser: newAsk,
      };
      return { sessions };
    });
  },

  maybeDeriveTitle: (sessionId, text) => {
    let derived: string | null = null;
    set((state) => {
      const idx = state.sessions.findIndex((s) => s.id === sessionId);
      if (idx === -1) return {};
      const s = state.sessions[idx];
      if (s.title !== DEFAULT_NEW_SESSION_TITLE || !text.trim()) return {};
      const newTitle = deriveTitleFromText(text);
      const sessions = state.sessions.slice();
      sessions[idx] = { ...s, title: newTitle };
      derived = newTitle;
      return { sessions };
    });
    if (derived) {
      const out = derived as string;
      void invoke("rename_session", {
        id: sessionId,
        title: out,
        origin: GUI_ORIGIN,
      }).catch((e) =>
        console.debug("[sessions] maybeDeriveTitle invoke failed.", e),
      );
    }
    return derived;
  },

  setLastStepIndex: (sessionId, step) => {
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          if (s.lastStepIndex === step) return s;
          return { ...s, lastStepIndex: step };
        },
      );
      return changed ? { sessions } : {};
    });
  },

  // ---- B4 M1 · external mirror entry points ----

  applyExternalSessionCreated: (brief) => {
    set((state) => {
      const activeRuntimeKind = usePrefsStore.getState().activeRuntimeKind;
      if (briefRuntimeKind(brief) !== activeRuntimeKind) {
        const sessions = state.sessions.filter((s) => s.id !== brief.id);
        const activeSessionId =
          state.activeSessionId === brief.id
            ? undefined
            : state.activeSessionId;
        return sessions.length === state.sessions.length &&
          activeSessionId === state.activeSessionId
          ? {}
          : { sessions, activeSessionId };
      }
      // Race guard: GUI may have just created the same id locally. The
      // SessionBriefWire from Rust is authoritative for durable fields
      // (status / title / project_id) but the GUI's local insert already
      // carries runtime-only defaults; replace in place when we find a
      // match, otherwise prepend.
      const idx = state.sessions.findIndex((s) => s.id === brief.id);
      if (idx === -1) {
        return { sessions: [sessionFromBrief(brief), ...state.sessions] };
      }
      const next = state.sessions.slice();
      next[idx] = { ...next[idx], ...sessionFromBrief(brief) };
      return { sessions: next };
    });
  },

  applyExternalSessionUpdated: (brief) => {
    set((state) => {
      const activeRuntimeKind = usePrefsStore.getState().activeRuntimeKind;
      if (briefRuntimeKind(brief) !== activeRuntimeKind) {
        const sessions = state.sessions.filter((s) => s.id !== brief.id);
        const activeSessionId =
          state.activeSessionId === brief.id
            ? undefined
            : state.activeSessionId;
        return sessions.length === state.sessions.length &&
          activeSessionId === state.activeSessionId
          ? {}
          : { sessions, activeSessionId };
      }
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        brief.id,
        (s) => ({
          ...s,
          title: brief.title,
          status: brief.status,
          projectId: brief.projectId,
          summary: brief.summary ?? s.summary,
          turnCount: brief.turnCount ?? s.turnCount,
          pinned: brief.pinned ?? s.pinned,
          hasUnread: brief.hasUnread ?? s.hasUnread,
          // M1.3 llm.set rides the session-updated channel — patch the
          // persisted LLM fields so the Composer pill / Inspector pick
          // up CLI-driven changes immediately.
          selectedLlmIndex: brief.selectedLlmIndex ?? s.selectedLlmIndex,
          selectedLlmKey: brief.selectedLlmKey ?? s.selectedLlmKey,
          selectedLlmDisplayName:
            brief.selectedLlmDisplayName ?? s.selectedLlmDisplayName,
          gaRuntimeKind: briefRuntimeKind(brief),
          gaRuntimeId: brief.gaRuntimeId,
          promptProfile: brief.promptProfile,
          lastActivityAt: brief.lastActivityAt,
          updatedAt: brief.updatedAt,
        }),
      );
      // Clear active selection if the active session was just archived
      // away from view (mirror archiveSession's existing behavior).
      if (
        changed &&
        brief.status === "archived" &&
        state.activeSessionId === brief.id
      ) {
        return { sessions, activeSessionId: undefined };
      }
      return changed ? { sessions } : {};
    });
  },

  applyExternalProjectCreated: (brief) => {
    set((state) => {
      // Race guard: if the GUI just created the same project locally,
      // merge in place rather than duplicating the row.
      const idx = state.projects.findIndex((p) => p.id === brief.id);
      if (idx === -1) {
        return { projects: [projectFromBrief(brief), ...state.projects] };
      }
      const next = state.projects.slice();
      next[idx] = { ...next[idx], ...projectFromBrief(brief) };
      return { projects: next };
    });
  },

  /// Mirror the FK SET NULL detach so the sidebar reflects reality
  /// without a hydrate round-trip. `detachedSessionIds` could be used
  /// to be precise but iterating sessions is cheap and tolerates any
  /// drift between the snapshot the socket handler took and the GUI's
  /// local view.
  applyExternalProjectDeleted: (projectId) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
      sessions: state.sessions.map((s) =>
        s.projectId === projectId ? { ...s, projectId: undefined } : s,
      ),
      activeProjectFilter:
        state.activeProjectFilter === projectId
          ? undefined
          : state.activeProjectFilter,
    }));
  },

  // ---- hydrate / dev ----

  hydrate: async () => {
    try {
      const activeRuntimeKind = usePrefsStore.getState().activeRuntimeKind;
      const briefs = await invokeHydrate<SessionBriefWire[]>("list_sessions", {
        filter: { runtimeKind: activeRuntimeKind },
      });
      const sessions = briefs.map(sessionFromBrief);
      set((state) => ({
        sessions,
        activeSessionId: sessions.some((s) => s.id === state.activeSessionId)
          ? state.activeSessionId
          : undefined,
      }));
    } catch (e) {
      console.warn("[sessions] hydrate sessions failed.", e);
    }
    try {
      const projects = await invokeHydrate<ProjectBriefWire[]>("list_projects");
      const nextProjects = projects.map(projectFromBrief);
      set((state) => ({
        projects: nextProjects,
        activeProjectFilter:
          state.activeProjectFilter &&
          nextProjects.some((p) => p.id === state.activeProjectFilter)
            ? state.activeProjectFilter
            : undefined,
      }));
    } catch (e) {
      console.debug("[sessions] hydrate projects failed.", e);
    }
  },
}));

/**
 * Mirror of summary truncation Rust does in `truncate_summary`
 * (core/src/db.rs SUMMARY_TRUNCATE_LEN = 80). Front-end keeps a
 * matching helper so optimistic in-memory state matches the value
 * Rust will persist — otherwise the freshly-rendered sidebar row
 * would diverge from the post-restart row by one char and surface
 * as a visual jitter when DB writes succeed slightly after the
 * in-memory mutation.
 *
 * NOTE: the GUI's prior local cap was 60; the Rust side picked 80
 * (more breathing room for a one-line preview). We adopt 80 here to
 * stay in sync with the persisted value.
 */
const SUMMARY_TRUNCATE_MAX = 80;
function truncateSummary(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= SUMMARY_TRUNCATE_MAX) return oneLine;
  return oneLine.slice(0, SUMMARY_TRUNCATE_MAX) + "…";
}
