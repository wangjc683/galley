import { invoke } from "@tauri-apps/api/core";

import {
  currentLLMDisplayName,
  managedModelsToLLMs,
} from "@/lib/managed-model-options";
import { effectiveApprovalMode } from "@/lib/approval-mode";
import { logPerf, perfNow } from "@/lib/perf";
import { toDurableStatus } from "@/lib/sessions";
import { useManagedModelsStore } from "@/stores/managed-models";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import type { LLMOption } from "@/stores/runtime";
import type { RuntimeKind, Session } from "@/types/session";

import {
  GUI_ORIGIN,
  MANAGED_PROMPT_PROFILE,
  briefRuntimeKind,
  patchSessionInList,
  sessionFromBrief,
  type SessionBriefWire,
  type SessionsSliceCreator,
} from "./shared";

// Monotonic counter for activateSession calls. When a first-visit
// activation defers its activeSessionId flip until the SQLite restore
// resolves (atomic conversation swap — see activateSession step 4), the
// captured epoch lets it detect that a newer activation superseded it
// mid-restore and skip the stale flip.
let _activationEpoch = 0;

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

interface LlmSelectionSnapshot {
  index: number;
  key: string;
  displayName: string;
}

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

/** "新对话" — seed title set by `createSession`. */
export const DEFAULT_NEW_SESSION_TITLE = "新对话";

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

export interface SessionLifecycleSlice {
  sessions: Session[];
  activeSessionId: string | undefined;

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
  createSessionPersisted: (
    projectId?: string,
    title?: string,
  ) => Promise<string>;
  renameSession: (sessionId: string, newTitle: string) => void;
  togglePinSession: (sessionId: string) => void;
  /**
   * Set or clear (null) the per-session approval-mode override, persist
   * it, and push the resulting effective mode to the session's live
   * bridge — unlike an LLM switch this takes effect immediately.
   */
  setSessionApprovalMode: (
    sessionId: string,
    mode: "auto" | "approval" | null,
  ) => void;
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
}

export const createSessionLifecycleSlice: SessionsSliceCreator<
  SessionLifecycleSlice
> = (set, get) => ({
  sessions: [],
  activeSessionId: undefined,

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
    const epoch = ++_activationEpoch;
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
    const needsRestore = looksFresh && hasHistory;
    // Atomic swap: when another conversation is on screen and this one
    // still needs its SQLite restore, keep the old transcript visible
    // and flip the active pointer only after the turns are in memory —
    // otherwise React paints one frame of "new session, zero turns"
    // (a blank conversation column) between the pointer flip and the
    // restore commit. When nothing is on screen (cold start / empty
    // state) deferring buys nothing, so flip immediately; same when no
    // restore is needed (revisit or fresh session), where the swap is
    // already synchronous.
    const prevActiveId = get().activeSessionId;
    const deferFlip =
      needsRestore && prevActiveId != null && prevActiveId !== id;
    if (!deferFlip) {
      get().setActiveSession(id);
    }
    if (needsRestore) {
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
    if (deferFlip) {
      // Stale-flip guard, two conditions because there are two ways to
      // lose the race while the restore was in flight:
      //   - epoch: a newer activateSession click owns the pointer now
      //     (even if it hasn't flipped yet — flipping here would land
      //     the user on the older click).
      //   - pointer: a non-activation path moved it directly
      //     (createSession, session delete, goal flows write
      //     activeSessionId without going through activateSession).
      // Either way we skip: the turns are already restored into
      // messagesStore, so the superseding action (or a later revisit)
      // gets them for free. Bridge spawn below still proceeds,
      // matching the previous behavior where every clicked session got
      // its bridge (the LRU governor bounds the population).
      if (
        epoch === _activationEpoch &&
        get().activeSessionId === prevActiveId
      ) {
        get().setActiveSession(id);
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
      const workspaceProject = session?.projectId
        ? get().projects.find((p) => p.id === session.projectId)
        : undefined;
      const workspaceRoot =
        workspaceProject?.workspaceEnabled && workspaceProject.rootPath
          ? workspaceProject.rootPath
          : undefined;
      const spawnStartedAt = perfNow();
      await useRuntimeStore.getState().spawnBridge({
        ...gaConfig,
        sessionId: id,
        cwd: undefined,
        workspaceRoot,
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
    // EmptyState's approval-mode pill stashes an explicit pre-pick the
    // same way the LLM picker stashes pendingLLMIndex: there is no
    // session row yet to write the override onto. Consume (and always
    // clear) it here so an abandoned pick can't leak into a later
    // unrelated session.
    const pendingApprovalMode = useRuntimeStore.getState().pendingApprovalMode;
    if (pendingApprovalMode !== undefined) {
      useRuntimeStore.setState({ pendingApprovalMode: undefined });
    }
    const newSession: Session = {
      id,
      title: DEFAULT_NEW_SESSION_TITLE,
      status: "idle",
      projectId,
      errorCount: 0,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      runtimeKind: gaRuntimeKind,
      runtimeLabel: gaRuntimeKind === "managed" ? "内置内核" : "外部 GA",
      gaRuntimeKind,
      promptProfile,
      approvalMode: pendingApprovalMode ?? null,
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
    })
      .then(() => {
        // Persist the pre-picked override after the row exists. The
        // bridge-side flag is synced by the on-`ready` handler, which
        // reads the (already optimistically set) session.approvalMode.
        if (!pendingApprovalMode) return;
        return invoke("set_session_approval_mode", {
          id,
          mode: pendingApprovalMode,
          origin: GUI_ORIGIN,
        });
      })
      .catch((e) => {
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
      errorCount: 0,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
      runtimeKind: gaRuntimeKind,
      runtimeLabel: gaRuntimeKind === "managed" ? "内置内核" : "外部 GA",
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

  setSessionApprovalMode: (sessionId, mode) => {
    // Override = DEVIATION from the default. Picking the mode that
    // equals the current default writes NULL (follow the default),
    // not a coincidentally-equal override — under the verb-row UI,
    // switching back reads as "undo my earlier switch", and a lingering
    // pin would keep surfacing restore affordances after a round trip.
    const defaultMode = effectiveApprovalMode(
      null,
      usePrefsStore.getState().yoloMode,
    );
    const normalized = mode === defaultMode ? null : mode;
    const now = new Date().toISOString();
    let applied = false;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          if (s.status === "archived") return s;
          applied = true;
          return { ...s, approvalMode: normalized, updatedAt: now };
        },
      );
      return changed ? { sessions } : {};
    });
    if (!applied) return;
    void invoke("set_session_approval_mode", {
      id: sessionId,
      mode: normalized,
      origin: GUI_ORIGIN,
    }).catch((e) =>
      console.debug("[sessions] set_session_approval_mode invoke failed.", e),
    );
    // Push the effective mode to the live bridge right away. No bridge
    // alive is fine — the on-`ready` sync in ipc-handlers.ts covers the
    // next spawn. Failure direction is safe (bridge keeps its previous
    // flag; approval mode errs toward more prompts, never fewer).
    const effective = effectiveApprovalMode(
      normalized,
      usePrefsStore.getState().yoloMode,
    );
    void useRuntimeStore
      .getState()
      .sendIPCCommand(sessionId, {
        kind: "set_yolo_mode",
        enabled: effective === "auto",
      })
      .catch((e) =>
        console.debug("[sessions] approval mode bridge sync failed.", e),
      );
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
      // "derived" keeps the row auto-title-upgradable (title_source
      // semantics, migration 038) — a plain rename would lock it as a
      // user title and the LLM auto-title would never fire.
      void invoke("rename_session", {
        id: sessionId,
        title: out,
        origin: GUI_ORIGIN,
        titleSource: "derived",
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
          status: toDurableStatus(brief.status),
          projectId: brief.projectId,
          summary: brief.summary ?? s.summary,
          turnCount: brief.turnCount ?? s.turnCount,
          pinned: brief.pinned ?? s.pinned,
          hasUnread: brief.hasUnread ?? s.hasUnread,
          // Absent (serde skips None) keeps the local value — the GUI
          // is the only writer and patches optimistically on change.
          approvalMode: brief.approvalMode ?? s.approvalMode,
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
});
