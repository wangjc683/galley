import { describe, expect, it } from "vitest";

import {
  buildSidebarSections,
  findSectionsSlot,
  type SidebarProjectGroupItem,
} from "@/lib/sidebar-timeline";
import type { Project, Session } from "@/types/session";

const NOW = new Date("2026-10-08T12:00:00");
const DAY = 24 * 3600 * 1000;
const ago = (days: number) =>
  new Date(NOW.getTime() - days * DAY).toISOString();

const session = (
  id: string,
  daysAgo: number,
  extra: Partial<Session> = {},
): Session =>
  ({
    id,
    title: id,
    status: "idle",
    errorCount: 0,
    lastActivityAt: ago(daysAgo),
    createdAt: ago(daysAgo),
    ...extra,
  }) as Session;

const project = (
  id: string,
  createdDaysAgo = 90,
  extra: Partial<Project> = {},
): Project =>
  ({
    id,
    name: id,
    workspaceEnabled: false,
    pinned: false,
    lastActivityAt: ago(createdDaysAgo),
    createdAt: ago(createdDaysAgo),
    updatedAt: ago(createdDaysAgo),
    ...extra,
  }) as Project;

const ids = (sessions: Session[]) => sessions.map((s) => s.id);

/** Compact shape: each group as `project[listed session ids…]`. */
const shape = (groups: SidebarProjectGroupItem[]) =>
  groups.map((g) => `${g.project.id}[${ids(g.sessions).join(",")}]`);

describe("buildSidebarSections", () => {
  it("keeps sessions outside projects in their time buckets", () => {
    const t = buildSidebarSections(
      [session("a", 0), session("b", 3), session("c", 20), session("d", 40)],
      [],
      { now: NOW },
    );
    expect(ids(t.buckets.today)).toEqual(["a"]);
    expect(ids(t.buckets.week)).toEqual(["b"]);
    expect(ids(t.buckets.month)).toEqual(["c"]);
    expect(ids(t.earlier)).toEqual(["d"]);
    expect(t.projects).toEqual([]);
  });

  it("keeps project sessions out of the time buckets", () => {
    const t = buildSidebarSections(
      [
        session("x", 0.1),
        session("p1", 0.2, { projectId: "p" }),
        session("p2", 3, { projectId: "p" }),
        session("p3", 20, { projectId: "p" }),
        session("y", 4),
      ],
      [project("p")],
      { now: NOW },
    );
    expect(ids(t.buckets.today)).toEqual(["x"]);
    expect(ids(t.buckets.week)).toEqual(["y"]);
    expect(t.buckets.month).toEqual([]);
    // Listed flat, newest first, across buckets.
    expect(shape(t.projects)).toEqual(["p[p1,p2,p3]"]);
  });

  it("keeps a group's older sessions behind 更早 and in its tail", () => {
    const t = buildSidebarSections(
      [
        session("p1", 1, { projectId: "p" }),
        session("p2", 45, { projectId: "p" }),
      ],
      [project("p")],
      { now: NOW },
    );
    expect(ids(t.projects[0].olderSessions)).toEqual(["p2"]);
    expect(ids(t.earlier)).toEqual(["p2"]);
    expect(t.groupedSessionIds.has("p2")).toBe(true);
  });

  it("keeps pinned project sessions in 置顶", () => {
    const t = buildSidebarSections(
      [
        session("pinned", 1, { projectId: "p", pinned: true }),
        session("p1", 0, { projectId: "p" }),
      ],
      [project("p")],
      { now: NOW },
    );
    expect(ids(t.pinned)).toEqual(["pinned"]);
    expect(shape(t.projects)).toEqual(["p[p1]"]);
    expect(t.buckets.today).toEqual([]);
  });

  it("folds a single-session project too", () => {
    const t = buildSidebarSections(
      [session("solo", 0, { projectId: "s" })],
      [project("s")],
      { now: NOW },
    );
    expect(shape(t.projects)).toEqual(["s[solo]"]);
    expect(t.buckets.today).toEqual([]);
  });

  it("lists pinned, active and new empty projects only", () => {
    const t = buildSidebarSections(
      [
        session("a1", 2, { projectId: "active" }),
        session("d1", 40, { projectId: "dormant" }),
        session("allPinned", 1, { projectId: "pinnedOnly", pinned: true }),
      ],
      [
        project("active"),
        project("dormant"),
        project("pinnedOnly"),
        project("fresh", 3),
        project("stale", 40),
        project("kept", 90, { pinned: true }),
      ],
      { now: NOW },
    );
    expect(t.projects.map((g) => g.project.id).sort()).toEqual([
      "active",
      "fresh",
      "kept",
    ]);
    // The dormant project's session stays behind 更早, ungrouped.
    expect(ids(t.earlier)).toEqual(["d1"]);
    expect(t.groupedSessionIds.has("d1")).toBe(false);
  });

  it("orders pinned projects first, then by content activity", () => {
    const t = buildSidebarSections(
      [
        session("o1", 5, { projectId: "older" }),
        session("n1", 1, { projectId: "newer" }),
        session("k1", 20, { projectId: "kept" }),
      ],
      [
        project("older"),
        project("kept", 90, { pinned: true }),
        project("newer"),
      ],
      { now: NOW },
    );
    expect(t.projects.map((g) => g.project.id)).toEqual([
      "kept",
      "newer",
      "older",
    ]);
  });

  it("treats an unknown projectId as no project", () => {
    const t = buildSidebarSections(
      [session("orphan", 0, { projectId: "gone" })],
      [],
      { now: NOW },
    );
    expect(ids(t.buckets.today)).toEqual(["orphan"]);
  });

  it("folds backfilled project sessions into their group", () => {
    const t = buildSidebarSections(
      [
        session("p1", 40, { projectId: "p" }),
        session("a", 41),
        session("p2", 42, { projectId: "p" }),
      ],
      [project("p")],
      { now: NOW },
    );
    expect(shape(t.projects)).toEqual(["p[p1,p2]"]);
    expect(ids(t.buckets.recent)).toEqual(["a"]);
    expect(t.earlier).toEqual([]);
  });

  it("finds the section of a grouped session, its older ones included", () => {
    const t = buildSidebarSections(
      [
        session("p1", 0, { projectId: "p" }),
        session("p2", 45, { projectId: "p" }),
        session("x", 2),
        session("old", 50),
      ],
      [project("p")],
      { now: NOW },
    );
    expect(findSectionsSlot(t, "p1")).toBe("projects");
    expect(findSectionsSlot(t, "p2")).toBe("projects");
    expect(findSectionsSlot(t, "x")).toBe("week");
    expect(findSectionsSlot(t, "old")).toBe("earlier");
    expect(findSectionsSlot(t, "missing")).toBeUndefined();
  });
});
