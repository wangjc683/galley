import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { copyForLanguage } from "@/lib/i18n";
import type { AppError } from "@/types/app-error";
import type { Project, Session } from "@/types/session";

import { useProjectNavigation } from "./useProjectNavigation";

const project = (id: string, name: string) =>
  ({
    id,
    name,
    workspaceEnabled: false,
    pinned: false,
    lastActivityAt: "2026-10-01T00:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  }) as Project;

const session = (id: string, projectId?: string) =>
  ({
    id,
    title: `title-${id}`,
    status: "idle",
    errorCount: 0,
    projectId,
    lastActivityAt: "2026-10-07T12:00:00.000Z",
    createdAt: "2026-10-07T12:00:00.000Z",
    updatedAt: "2026-10-07T12:00:00.000Z",
  }) as Session;

/** Render the hook once and hand back its result plus the recorded
 * calls. The calls under test touch only the injected callbacks, so
 * they can run after the static render. */
function setup(activeSessionId: string | undefined) {
  const setActiveProjectFilter = vi.fn<(id: string | undefined) => void>();
  const pushToast = vi.fn<(error: AppError) => void>();
  const assignSessionToProject = vi.fn(async () => {});
  let nav: ReturnType<typeof useProjectNavigation> | undefined;
  function Probe() {
    nav = useProjectNavigation({
      activeProjectFilter: undefined,
      activeSessionBusy: false,
      activeSessionId,
      assignSessionToProject,
      copy: copyForLanguage("zh-CN"),
      projects: [project("a", "回归")],
      pushToast,
      setActiveProjectFilter,
      setActiveSession: () => {},
      setEmptyComposerFocusTick: () => {},
      setScreen: () => {},
      visibleSessions: [session("open", "a"), session("other")],
    });
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return {
    nav: nav!,
    setActiveProjectFilter,
    pushToast,
    assignSessionToProject,
  };
}

describe("useProjectNavigation · assignSessionToProjectWithToast", () => {
  it("moves the project context with the open conversation", () => {
    const moved = setup("open");
    moved.nav.assignSessionToProjectWithToast("open", "b");
    expect(moved.setActiveProjectFilter).toHaveBeenCalledWith("b");

    const removed = setup("open");
    removed.nav.assignSessionToProjectWithToast("open", null);
    expect(removed.setActiveProjectFilter).toHaveBeenCalledWith(undefined);
  });

  it("leaves the context alone for another session or the empty screen", () => {
    const other = setup("open");
    other.nav.assignSessionToProjectWithToast("other", "a");
    expect(other.setActiveProjectFilter).not.toHaveBeenCalled();

    // On the empty screen App passes no active session.
    const empty = setup(undefined);
    empty.nav.assignSessionToProjectWithToast("open", null);
    expect(empty.setActiveProjectFilter).not.toHaveBeenCalled();
  });

  it("names a project created this tick in the toast", async () => {
    const { nav, pushToast, assignSessionToProject } = setup("open");
    nav.assignSessionToProjectWithToast("other", "fresh", "新项目");
    expect(assignSessionToProject).toHaveBeenCalledWith("other", "fresh");
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalled());
    expect(pushToast.mock.calls[0][0].title).toBe("已加入 新项目");
  });
});
