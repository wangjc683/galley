import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { listenCoreRowEvents } from "@/lib/core-row-events";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import {
  sessionFromBrief,
  type ProjectBriefWire,
  type SessionBriefWire,
} from "@/stores/sessions/shared";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type { Project, Session } from "@/types/session";

/**
 * Ticket 02d: Core broadcasts every session / project write — this
 * page's own included — in its event form (every optional field present,
 * `null` when cleared). This page still applies its writes first (02e is
 * P1), so applying the broadcast of its own write must change nothing.
 */

const tauriMocks = getTauriMocks();

/** Core's event form of a session row: every optional field written,
 * `null` when empty (`SessionBriefEvent`). */
function eventRow(
  s: Session,
  overrides: Partial<SessionBriefWire> = {},
): SessionBriefWire {
  return {
    id: s.id,
    projectId: s.projectId ?? null,
    title: s.title,
    status: s.status,
    summary: s.summary ?? null,
    turnCount: s.turnCount ?? 0,
    lastActivityAt: s.lastActivityAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    pinned: s.pinned ?? false,
    hasUnread: s.hasUnread ?? false,
    origin: s.origin ?? null,
    selectedLlmIndex: s.selectedLlmIndex ?? null,
    selectedLlmKey: s.selectedLlmKey ?? null,
    selectedLlmDisplayName: s.selectedLlmDisplayName ?? null,
    runtimeKind: s.runtimeKind,
    runtimeLabel: s.runtimeLabel,
    gaRuntimeKind: s.gaRuntimeKind,
    gaRuntimeId: s.gaRuntimeId ?? null,
    promptProfile: s.promptProfile ?? null,
    reasoningEffort: s.reasoningEffort ?? null,
    ...overrides,
  };
}

function projectEventRow(
  p: Project,
  overrides: Partial<ProjectBriefWire> = {},
): ProjectBriefWire {
  return {
    id: p.id,
    name: p.name,
    rootPath: p.rootPath ?? null,
    workspaceEnabled: p.workspaceEnabled,
    icon: p.icon ?? null,
    color: p.color ?? null,
    pinned: p.pinned,
    lastActivityAt: p.lastActivityAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ...overrides,
  };
}

/** A row as hydrate loads it (defaults filled in, as from Core). */
function hydrated(overrides: Partial<Session> = {}): Session {
  return sessionFromBrief(eventRow(makeSession(overrides)));
}

function row(id = "s-test"): Session {
  const found = useSessionsStore.getState().sessions.find((s) => s.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

function seed(sessions: Session[], activeSessionId?: string) {
  useSessionsStore.setState({ sessions, activeSessionId });
}

/** Everything the echo must leave alone. */
function snapshot() {
  const sessions = useSessionsStore.getState();
  return {
    sessions: sessions.sessions,
    activeSessionId: sessions.activeSessionId,
    projects: sessions.projects,
    toasts: useUiStore.getState().toasts.length,
    invokes: tauriMocks.invoke.mock.calls.length,
  };
}

/** Apply `brief` as Core broadcasts it and assert nothing visible moved:
 * same rows (field for field), same open session, no toast, no write. */
function expectEchoIsNoop(apply: () => void) {
  const before = snapshot();
  apply();
  const after = snapshot();
  expect(after.sessions).toEqual(before.sessions);
  expect(after.activeSessionId).toBe(before.activeSessionId);
  expect(after.projects).toEqual(before.projects);
  expect(after.toasts).toBe(before.toasts);
  expect(after.invokes).toBe(before.invokes);
}

function invokesOf(command: string) {
  return tauriMocks.invoke.mock.calls.filter((call) => call[0] === command);
}

beforeEach(() => {
  resetStores();
  // The rows below are external-runtime sessions; a row of the other
  // runtime is dropped from the sidebar on sight.
  usePrefsStore.setState({ activeRuntimeKind: "external" });
});

describe("applyExternalSessionUpdated · cleared vs not sent", () => {
  const full = () =>
    makeSession({
      projectId: "proj_a",
      summary: "上一轮",
      turnCount: 3,
      pinned: true,
      hasUnread: true,
      reasoningEffort: "high",
      selectedLlmIndex: 2,
      selectedLlmKey: "glm-5.1",
      selectedLlmDisplayName: "GLM 5.1",
      gaRuntimeId: "rt",
      promptProfile: "galley-persona-v1",
    });

  it("a field sent as null is cleared", () => {
    seed([full()]);
    useSessionsStore.getState().applyExternalSessionUpdated(
      eventRow(full(), {
        projectId: null,
        summary: null,
        pinned: null,
        hasUnread: null,
        reasoningEffort: null,
        selectedLlmIndex: null,
        selectedLlmKey: null,
        selectedLlmDisplayName: null,
        gaRuntimeId: null,
        promptProfile: null,
      }),
    );
    expect(row()).toMatchObject({
      projectId: undefined,
      summary: undefined,
      pinned: false,
      hasUnread: false,
      reasoningEffort: null,
      selectedLlmIndex: undefined,
      selectedLlmKey: undefined,
      selectedLlmDisplayName: undefined,
      gaRuntimeId: undefined,
      promptProfile: undefined,
    });
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it("a field the payload lacks keeps its value (older payloads)", () => {
    seed([full()]);
    useSessionsStore.getState().applyExternalSessionUpdated({
      id: "s-test",
      title: "新标题",
      status: "idle",
      lastActivityAt: full().lastActivityAt,
      createdAt: full().createdAt,
      updatedAt: "2026-10-10T00:00:00Z",
      gaRuntimeKind: "external",
    });
    expect(row()).toMatchObject({
      title: "新标题",
      projectId: "proj_a",
      summary: "上一轮",
      turnCount: 3,
      pinned: true,
      hasUnread: true,
      reasoningEffort: "high",
      selectedLlmIndex: 2,
      selectedLlmKey: "glm-5.1",
      selectedLlmDisplayName: "GLM 5.1",
      gaRuntimeId: "rt",
      promptProfile: "galley-persona-v1",
      updatedAt: "2026-10-10T00:00:00Z",
    });
  });

  it("turn progress is only taken from a row at least as far along", () => {
    const local = makeSession({
      turnCount: 5,
      summary: "第五轮",
      lastActivityAt: "2026-10-10T08:00:05.000Z",
    });
    seed([local]);
    // A write's broadcast that read the row before Core's own bump.
    useSessionsStore.getState().applyExternalSessionUpdated(
      eventRow(local, {
        turnCount: 4,
        summary: "第四轮",
        lastActivityAt: "2026-10-10T08:00:00Z",
        hasUnread: true,
      }),
    );
    expect(row()).toMatchObject({
      turnCount: 5,
      summary: "第五轮",
      lastActivityAt: "2026-10-10T08:00:05.000Z",
      // Everything else still applies.
      hasUnread: true,
    });

    useSessionsStore.getState().applyExternalSessionUpdated(
      eventRow(local, {
        turnCount: 6,
        summary: "第六轮",
        lastActivityAt: "2026-10-10T08:01:00Z",
      }),
    );
    expect(row()).toMatchObject({
      turnCount: 6,
      summary: "第六轮",
      lastActivityAt: "2026-10-10T08:01:00Z",
    });
  });

  it("a broadcast that matches the row keeps the same object", () => {
    seed([full()]);
    const before = row();
    useSessionsStore.getState().applyExternalSessionUpdated(eventRow(before));
    expect(row()).toBe(before);
  });
});

describe("applyExternalSessionCreated / Deleted", () => {
  it("inserts another frontend's session, nulls read as absent", () => {
    useSessionsStore
      .getState()
      .applyExternalSessionCreated(
        eventRow(makeSession({ id: "s-cli", title: "CLI 建的" })),
      );
    expect(row("s-cli")).toMatchObject({
      title: "CLI 建的",
      projectId: undefined,
      summary: undefined,
      selectedLlmKey: undefined,
      origin: undefined,
      reasoningEffort: null,
    });
    expect(row("s-cli").projectId).not.toBeNull();
  });

  it("the broadcast of a session this page created leaves its row alone", () => {
    // The page's row has moved on (an EmptyState effort pick, a derived
    // title); the broadcast is the row as Core created it.
    const local = makeSession({ id: "s-mine", reasoningEffort: "high" });
    seed([local], "s-mine");
    expectEchoIsNoop(() =>
      useSessionsStore
        .getState()
        .applyExternalSessionCreated(
          eventRow(local, { reasoningEffort: null, title: "新对话" }),
        ),
    );
    expect(row("s-mine")).toBe(local);
  });

  it("a delete forgets the row, the open session and its messages, idempotently", () => {
    seed([makeSession({ id: "a" }), makeSession({ id: "b" })], "a");
    useMessagesStore.getState().ensureMessages("a");

    useSessionsStore.getState().applyExternalSessionDeleted("a");
    useSessionsStore.getState().applyExternalSessionDeleted("a");
    useSessionsStore.getState().applyExternalSessionDeleted("ghost");

    const state = useSessionsStore.getState();
    expect(state.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(state.activeSessionId).toBeUndefined();
    expect(useMessagesStore.getState().byId.a).toBeUndefined();
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });

  it("a delete of another session keeps the open one", () => {
    seed([makeSession({ id: "a" }), makeSession({ id: "b" })], "b");
    useSessionsStore.getState().applyExternalSessionDeleted("a");
    expect(useSessionsStore.getState().activeSessionId).toBe("b");
  });
});

describe("the broadcast of this page's own write changes nothing", () => {
  it("rename", () => {
    seed([hydrated()], "s-test");
    useSessionsStore.getState().renameSession("s-test", "新名字");
    expectEchoIsNoop(() =>
      useSessionsStore.getState().applyExternalSessionUpdated(eventRow(row())),
    );
    expect(row().title).toBe("新名字");
  });

  it("pin", () => {
    seed([hydrated()], "s-test");
    useSessionsStore.getState().togglePinSession("s-test");
    expectEchoIsNoop(() =>
      useSessionsStore.getState().applyExternalSessionUpdated(eventRow(row())),
    );
    expect(row().pinned).toBe(true);
  });

  it("clearing the reasoning effort", () => {
    seed([hydrated({ reasoningEffort: "high" })], "s-test");
    useRuntimeStore.getState().ensureRuntime("s-test", {});
    useSessionsStore.getState().setSessionReasoningEffort("s-test", null);
    expect(row().reasoningEffort).toBeNull();
    expectEchoIsNoop(() =>
      useSessionsStore
        .getState()
        .applyExternalSessionUpdated(
          eventRow(row(), { reasoningEffort: null }),
        ),
    );
  });

  it("moving out of a project", () => {
    seed([hydrated({ projectId: "proj_a" })], "s-test");
    void useSessionsStore.getState().assignSessionToProject("s-test", null);
    expect(row().projectId).toBeUndefined();
    expectEchoIsNoop(() =>
      useSessionsStore
        .getState()
        .applyExternalSessionUpdated(eventRow(row(), { projectId: null })),
    );
  });

  it("marking a finished reply unread: no rollback of the bump, no clear", () => {
    seed([hydrated({ id: "a" }), hydrated({ id: "b", turnCount: 2 })], "a");
    useSessionsStore
      .getState()
      .bumpSessionAfterTurn("b", "第三轮的回答", 3, true);
    expect(row("b")).toMatchObject({ turnCount: 3, hasUnread: true });
    expect(invokesOf("mark_session_unread")).toHaveLength(1);
    // Core read the row for the broadcast before its own bump landed.
    expectEchoIsNoop(() =>
      useSessionsStore.getState().applyExternalSessionUpdated(
        eventRow(row("b"), {
          turnCount: 2,
          summary: null,
          lastActivityAt: "2026-06-18T07:00:00Z",
        }),
      ),
    );
    expect(invokesOf("clear_session_unread")).toHaveLength(0);
  });

  it("opening an unread session: one clear, the echo writes nothing", () => {
    seed([hydrated({ id: "a", hasUnread: true }), hydrated({ id: "b" })], "b");
    useSessionsStore.getState().setActiveSession("a");
    expect(invokesOf("clear_session_unread")).toHaveLength(1);
    expectEchoIsNoop(() =>
      useSessionsStore
        .getState()
        .applyExternalSessionUpdated(eventRow(row("a"))),
    );
    expect(useSessionsStore.getState().activeSessionId).toBe("a");
  });

  it("archive: one toast, the open session stays closed, no second write", () => {
    seed([hydrated({ id: "a" }), hydrated({ id: "b" })], "a");
    useSessionsStore.getState().archiveSession("a");
    expect(useUiStore.getState().toasts).toHaveLength(1);
    expect(useSessionsStore.getState().activeSessionId).toBeUndefined();
    expectEchoIsNoop(() =>
      useSessionsStore
        .getState()
        .applyExternalSessionUpdated(eventRow(row("a"))),
    );
  });

  it("bulk archive: one toast for the batch, one broadcast per session", () => {
    seed([hydrated({ id: "a" }), hydrated({ id: "b" })], "b");
    useSessionsStore.getState().archiveSessionsBulk(["a", "b"]);
    expect(useUiStore.getState().toasts).toHaveLength(1);
    expectEchoIsNoop(() => {
      useSessionsStore
        .getState()
        .applyExternalSessionUpdated(eventRow(row("a")));
      useSessionsStore
        .getState()
        .applyExternalSessionUpdated(eventRow(row("b")));
    });
  });

  it("unarchive: the restored session is not switched to or away from", () => {
    seed(
      [hydrated({ id: "a", status: "archived" }), hydrated({ id: "b" })],
      "b",
    );
    useSessionsStore.getState().unarchiveSession("a");
    expectEchoIsNoop(() =>
      useSessionsStore
        .getState()
        .applyExternalSessionUpdated(eventRow(row("a"))),
    );
  });

  it("delete: the broadcast landing before or after the invoke resolves", async () => {
    seed([hydrated({ id: "a" }), hydrated({ id: "b" })], "a");
    useMessagesStore.getState().ensureMessages("a");
    // Core emits before it answers the invoke.
    tauriMocks.invoke.mockImplementation(async (command, args) => {
      if (command === "delete_session") {
        useSessionsStore
          .getState()
          .applyExternalSessionDeleted((args as { id: string }).id);
      }
      return undefined;
    });

    await useSessionsStore.getState().deleteSessionPermanently("a");

    const state = useSessionsStore.getState();
    expect(state.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(state.activeSessionId).toBeUndefined();
    expect(useMessagesStore.getState().byId.a).toBeUndefined();
    expect(invokesOf("delete_session")).toHaveLength(1);
    expect(useUiStore.getState().toasts).toHaveLength(0);
    // And once more after.
    expectEchoIsNoop(() =>
      useSessionsStore.getState().applyExternalSessionDeleted("a"),
    );
  });

  it("create: no second row, the new session stays open", () => {
    useRuntimeStore.setState({ pendingReasoningEffort: "high" });
    const id = useSessionsStore.getState().createSession();
    expect(row(id).reasoningEffort).toBe("high");
    expectEchoIsNoop(() =>
      useSessionsStore
        .getState()
        .applyExternalSessionCreated(
          eventRow(row(id), { reasoningEffort: null }),
        ),
    );
    expect(useSessionsStore.getState().sessions).toHaveLength(1);
    expect(useSessionsStore.getState().activeSessionId).toBe(id);
  });

  it("a model pick: the echo does not send the pick again", async () => {
    seed([hydrated()], "s-test");
    useRuntimeStore.getState().ensureRuntime("s-test", {
      cachedLLMs: [
        { index: 0, key: "a", displayName: "A", isCurrent: true },
        { index: 1, key: "b", displayName: "B", isCurrent: false },
      ],
    });
    useRuntimeStore.getState().selectLLMForSession("s-test", 1);
    await Promise.resolve();
    expect(invokesOf("set_session_llm")).toHaveLength(1);
    expectEchoIsNoop(() =>
      useSessionsStore.getState().applyExternalSessionUpdated(eventRow(row())),
    );
  });

  it("project create / update / delete", async () => {
    const p = await useSessionsStore
      .getState()
      .createProject({ name: "甲", rootPath: "/tmp/a" });
    expectEchoIsNoop(() =>
      useSessionsStore
        .getState()
        .applyExternalProjectCreated(projectEventRow(p)),
    );

    await useSessionsStore.getState().updateProject(p.id, { rootPath: "" });
    const updated = useSessionsStore.getState().projects[0];
    expect(updated.rootPath).toBeUndefined();
    expectEchoIsNoop(() =>
      useSessionsStore
        .getState()
        .applyExternalProjectUpdated(
          projectEventRow(updated, { rootPath: null }),
        ),
    );

    await useSessionsStore.getState().deleteProject(p.id);
    expectEchoIsNoop(() =>
      useSessionsStore.getState().applyExternalProjectDeleted(p.id),
    );
    expect(useSessionsStore.getState().projects).toHaveLength(0);
  });
});

describe("applyExternalProjectUpdated", () => {
  const project: Project = {
    id: "proj_a",
    name: "甲",
    rootPath: "/tmp/a",
    workspaceEnabled: true,
    icon: "📁",
    color: "red",
    pinned: false,
    lastActivityAt: "2026-10-10T00:00:00Z",
    createdAt: "2026-10-10T00:00:00Z",
    updatedAt: "2026-10-10T00:00:00Z",
  };

  it("null clears, a missing key keeps, an unknown project is ignored", () => {
    useSessionsStore.setState({ projects: [project] });
    useSessionsStore.getState().applyExternalProjectUpdated({
      id: "proj_a",
      name: "乙",
      rootPath: null,
      workspaceEnabled: false,
      pinned: true,
      lastActivityAt: project.lastActivityAt,
      createdAt: project.createdAt,
      updatedAt: "2026-10-10T01:00:00Z",
    });
    expect(useSessionsStore.getState().projects[0]).toEqual({
      ...project,
      name: "乙",
      rootPath: undefined,
      workspaceEnabled: false,
      pinned: true,
      updatedAt: "2026-10-10T01:00:00Z",
    });

    useSessionsStore
      .getState()
      .applyExternalProjectUpdated(
        projectEventRow({ ...project, id: "proj_ghost" }),
      );
    expect(useSessionsStore.getState().projects).toHaveLength(1);
  });
});

describe("Core row events", () => {
  it("every row event is routed to its store action", async () => {
    const handlers = new Map<string, (e: { payload: unknown }) => void>();
    let detached = 0;
    tauriMocks.listen.mockImplementation(async (event, handler) => {
      handlers.set(event, handler as (e: { payload: unknown }) => void);
      return () => {
        detached += 1;
      };
    });
    seed(
      [makeSession({ id: "a", projectId: "proj_a" }), makeSession({ id: "b" })],
      "a",
    );
    useSessionsStore.setState({
      projects: [
        {
          id: "proj_a",
          name: "甲",
          rootPath: "/tmp/a",
          workspaceEnabled: true,
          pinned: false,
          lastActivityAt: "t",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    });

    const unlisten = await listenCoreRowEvents();
    expect([...handlers.keys()].sort()).toEqual(
      [
        "project-created-external",
        "project-deleted-external",
        "project-updated-external",
        "session-archived-external",
        "session-created-external",
        "session-deleted-external",
        "session-moved-external",
        "session-unarchived-external",
        "session-updated-external",
      ].sort(),
    );

    handlers.get("session-moved-external")!({
      payload: { session: eventRow(row("a"), { projectId: null }), via: "gui" },
    });
    expect(row("a").projectId).toBeUndefined();

    handlers.get("project-updated-external")!({
      payload: {
        project: {
          id: "proj_a",
          name: "乙",
          rootPath: null,
          workspaceEnabled: false,
          icon: null,
          color: null,
          pinned: false,
          lastActivityAt: "t",
          createdAt: "t",
          updatedAt: "t2",
        },
        via: "gui",
      },
    });
    expect(useSessionsStore.getState().projects[0]).toMatchObject({
      name: "乙",
      rootPath: undefined,
    });

    handlers.get("session-deleted-external")!({
      payload: { sessionId: "a", via: "gui" },
    });
    expect(useSessionsStore.getState().sessions.map((s) => s.id)).toEqual([
      "b",
    ]);
    expect(useSessionsStore.getState().activeSessionId).toBeUndefined();

    unlisten();
    expect(detached).toBe(handlers.size);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
  });
});

describe("the page sends no set_llm itself", () => {
  it("a pick reaches the runner through Core's set_session_llm", async () => {
    let bridgeCommands = 0;
    seed([makeSession({ selectedLlmIndex: 1, selectedLlmKey: "b" })], "s-test");
    useRuntimeStore.setState({
      sendIPCCommand: async () => {
        bridgeCommands += 1;
      },
    });
    useRuntimeStore.getState().ensureRuntime("s-test", {
      cachedLLMs: [
        { index: 0, key: "a", displayName: "A", isCurrent: false },
        { index: 1, key: "b", displayName: "B", isCurrent: true },
      ],
    });

    // Picking the model the row already holds still goes to Core: Core is
    // what tells the runner now.
    useRuntimeStore.getState().selectLLMForSession("s-test", 1);
    await Promise.resolve();

    expect(bridgeCommands).toBe(0);
    expect(invokesOf("set_session_llm")).toEqual([
      [
        "set_session_llm",
        {
          id: "s-test",
          index: 1,
          key: "b",
          displayName: "B",
          runnerReported: false,
        },
      ],
    ]);
  });

  it("a model the runner reported is persisted only when it differs", async () => {
    seed([
      makeSession({
        selectedLlmIndex: 1,
        selectedLlmKey: "b",
        selectedLlmDisplayName: "B",
      }),
    ]);
    const llms = [
      { index: 0, key: "a", displayName: "A", isCurrent: false },
      { index: 1, key: "b", displayName: "B", isCurrent: true },
    ];
    useRuntimeStore.getState().replaceLLMs("s-test", llms);
    await Promise.resolve();
    expect(invokesOf("set_session_llm")).toHaveLength(0);
  });

  it("no source file outside the IPC types names set_llm", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        if (full.endsWith(path.join("types", "ipc.ts"))) continue;
        if (readFileSync(full, "utf8").includes('"set_llm"')) {
          offenders.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
