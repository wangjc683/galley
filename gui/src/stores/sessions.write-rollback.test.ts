import { beforeEach, describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type { Project, Session } from "@/types/session";

/**
 * Writes Core refuses (2026-11-10 audit, A7): each session and project
 * write changes memory first; when its command is refused, memory goes
 * back to what it was, one error toast says so, and no receipt
 * (已归档 and the like) shows.
 */

const tauriMocks = getTauriMocks();
const REFUSAL = "database is locked";
const LONG_AGO = "2026-06-18T08:00:00.000Z";

/** Every command answers as usual, except `command`, which Core refuses. */
function refuse(command: string) {
  tauriMocks.invoke.mockImplementation(async (name) => {
    if (name === command) throw REFUSAL;
    return undefined;
  });
}

function sessions(): Session[] {
  return useSessionsStore.getState().sessions;
}

function projects(): Project[] {
  return useSessionsStore.getState().projects;
}

function row(id = "s-test"): Session {
  const found = sessions().find((s) => s.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

/** The one toast a refusal leaves: an error with Core's words. */
function expectOnlyTheRefusalToast(context: string) {
  const toasts = useUiStore.getState().toasts;
  expect(toasts).toHaveLength(1);
  expect(toasts[0]).toMatchObject({
    severity: "error",
    category: "business",
    message: REFUSAL,
    context,
  });
  // No explicit title: the card's default, 操作未能完成.
  expect(toasts[0].title).toBeUndefined();
}

const project = (overrides: Partial<Project> = {}): Project => ({
  id: "proj_a",
  name: "甲",
  rootPath: "/tmp/a",
  workspaceEnabled: true,
  pinned: false,
  lastActivityAt: LONG_AGO,
  createdAt: LONG_AGO,
  updatedAt: LONG_AGO,
  ...overrides,
});

beforeEach(() => {
  resetStores();
  usePrefsStore.setState({ activeRuntimeKind: "external" });
});

describe("a refused session write goes back", () => {
  it("archive: the row comes back, the open session stays closed, no 已归档", async () => {
    const before = [makeSession({ id: "a" }), makeSession({ id: "b" })];
    useSessionsStore.setState({ sessions: before, activeSessionId: "a" });
    refuse("archive_session");

    await useSessionsStore.getState().archiveSession("a");

    expect(sessions()).toEqual(before);
    expect(useSessionsStore.getState().activeSessionId).toBeUndefined();
    expectOnlyTheRefusalToast("archiveSession");
  });

  it("unarchive", async () => {
    const before = [makeSession({ status: "archived" })];
    useSessionsStore.setState({ sessions: before });
    refuse("unarchive_session");

    await useSessionsStore.getState().unarchiveSession("s-test");

    expect(sessions()).toEqual(before);
    expectOnlyTheRefusalToast("unarchiveSession");
  });

  it("bulk archive: every row of the batch comes back, no 已归档 N 个", async () => {
    const before = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
      makeSession({ id: "c", status: "archived" }),
    ];
    useSessionsStore.setState({ sessions: before });
    refuse("bulk_archive_sessions");

    await useSessionsStore.getState().archiveSessionsBulk(["a", "b", "c"]);

    expect(sessions()).toEqual(before);
    expectOnlyTheRefusalToast("archiveSessionsBulk");
  });

  it("bulk unarchive", async () => {
    const before = [
      makeSession({ id: "a", status: "archived" }),
      makeSession({ id: "b", status: "archived" }),
    ];
    useSessionsStore.setState({ sessions: before });
    refuse("bulk_unarchive_sessions");

    await useSessionsStore.getState().unarchiveSessionsBulk(["a", "b"]);

    expect(sessions()).toEqual(before);
    expectOnlyTheRefusalToast("unarchiveSessionsBulk");
  });

  it("rename", async () => {
    const before = [makeSession({ title: "旧名" })];
    useSessionsStore.setState({ sessions: before });
    refuse("rename_session");

    await useSessionsStore.getState().renameSession("s-test", "新名");

    expect(sessions()).toEqual(before);
    expectOnlyTheRefusalToast("renameSession");
  });

  it("pin", async () => {
    const before = [makeSession({ pinned: false })];
    useSessionsStore.setState({ sessions: before });
    refuse("set_session_pinned");

    await useSessionsStore.getState().togglePinSession("s-test");

    expect(sessions()).toEqual(before);
    expectOnlyTheRefusalToast("togglePinSession");
  });

  it("reasoning effort", async () => {
    const before = [makeSession({ reasoningEffort: "low" })];
    useSessionsStore.setState({ sessions: before });
    useRuntimeStore.getState().ensureRuntime("s-test", {});
    refuse("set_session_reasoning_effort");

    await useSessionsStore
      .getState()
      .setSessionReasoningEffort("s-test", "high");

    expect(sessions()).toEqual(before);
    expectOnlyTheRefusalToast("setSessionReasoningEffort");
  });

  it("move into a project: the row comes back and the call rejects", async () => {
    const before = [makeSession()];
    useSessionsStore.setState({ sessions: before });
    refuse("assign_session_to_project");

    await expect(
      useSessionsStore.getState().assignSessionToProject("s-test", "proj_a"),
    ).rejects.toBe(REFUSAL);

    expect(sessions()).toEqual(before);
    expectOnlyTheRefusalToast("assignSessionToProject");
  });

  it("a field something else changed meanwhile keeps the newer value", async () => {
    useSessionsStore.setState({ sessions: [makeSession({ title: "旧名" })] });
    let refuseNow: (reason: unknown) => void = () => {};
    tauriMocks.invoke.mockImplementation(
      (name) =>
        new Promise((resolve, reject) => {
          if (name === "rename_session") refuseNow = reject;
          else resolve(undefined);
        }),
    );

    const renaming = useSessionsStore
      .getState()
      .renameSession("s-test", "新名");
    expect(row().title).toBe("新名");
    // Another writer's title lands (a Core broadcast, an auto title).
    useSessionsStore.setState({
      sessions: [{ ...row(), title: "别人的名" }],
    });
    refuseNow(REFUSAL);
    await renaming;

    expect(row().title).toBe("别人的名");
    expectOnlyTheRefusalToast("renameSession");
  });

  it("the receipt still follows a write Core takes", async () => {
    usePrefsStore.setState({ languagePreference: "zh-CN" });
    useSessionsStore.setState({ sessions: [makeSession({ id: "a" })] });

    await useSessionsStore.getState().archiveSession("a");

    const toasts = useUiStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      severity: "info",
      title: zhCopy.toasts.archived,
    });
  });
});

describe("a refused project write goes back", () => {
  it("create: the project is gone again and the call rejects", async () => {
    refuse("create_project");

    await expect(
      useSessionsStore.getState().createProject({ name: "甲" }),
    ).rejects.toBe(REFUSAL);

    expect(projects()).toEqual([]);
    expectOnlyTheRefusalToast("createProject");
  });

  it("update: the project's fields come back and the call rejects", async () => {
    const before = [project()];
    useSessionsStore.setState({ projects: before });
    refuse("update_project");

    await expect(
      useSessionsStore
        .getState()
        .updateProject("proj_a", { name: "乙", rootPath: "" }),
    ).rejects.toBe(REFUSAL);

    expect(projects()).toEqual(before);
    expectOnlyTheRefusalToast("updateProject");
  });

  it("delete: the project, its sessions' link and the filter come back", async () => {
    const before = [
      project({ id: "proj_0" }),
      project(),
      project({ id: "proj_z" }),
    ];
    const rows = [
      makeSession({ id: "in", projectId: "proj_a" }),
      makeSession({ id: "out" }),
    ];
    useSessionsStore.setState({
      projects: before,
      sessions: rows,
      activeProjectFilter: "proj_a",
    });
    refuse("delete_project");

    await useSessionsStore.getState().deleteProject("proj_a");

    expect(projects()).toEqual(before);
    expect(sessions()).toEqual(rows);
    expect(useSessionsStore.getState().activeProjectFilter).toBe("proj_a");
    expectOnlyTheRefusalToast("deleteProject");
  });
});
