import { describe, expect, it } from "vitest";

import {
  buildSidebarTimeline,
  findTimelineBucket,
  type SidebarTimelineItem,
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

/** Compact shape: session rows by id, groups as `[project ids…]`. */
const shape = (items: SidebarTimelineItem[]) =>
  items.map((item) =>
    item.kind === "session"
      ? item.session.id
      : `${item.project.id}[${item.sessions.map((s) => s.id).join(",")}]`,
  );

describe("buildSidebarTimeline", () => {
  it("keeps sessions outside projects as plain rows in their buckets", () => {
    const t = buildSidebarTimeline(
      [session("a", 0), session("b", 3), session("c", 20), session("d", 40)],
      [],
      { now: NOW },
    );
    expect(shape(t.items.today)).toEqual(["a"]);
    expect(shape(t.items.week)).toEqual(["b"]);
    expect(shape(t.items.month)).toEqual(["c"]);
    expect(t.earlier.map((s) => s.id)).toEqual(["d"]);
  });

  it("folds a project into one group in its newest session's bucket", () => {
    const t = buildSidebarTimeline(
      [
        session("x", 0.1),
        session("p1", 0.2, { projectId: "p" }),
        session("y", 0.3),
        session("p2", 3, { projectId: "p" }),
        session("p3", 20, { projectId: "p" }),
      ],
      [project("p")],
      { now: NOW },
    );
    // Interleaved by activity, listed flat newest first across buckets.
    expect(shape(t.items.today)).toEqual(["x", "p[p1,p2,p3]", "y"]);
    expect(t.items.week).toEqual([]);
    expect(t.items.month).toEqual([]);
  });

  it("keeps a group's older sessions behind 更早 and in its tail", () => {
    const t = buildSidebarTimeline(
      [
        session("p1", 1, { projectId: "p" }),
        session("p2", 45, { projectId: "p" }),
      ],
      [project("p")],
      { now: NOW },
    );
    const group = t.items.week[0];
    expect(
      group.kind === "project" && group.olderSessions.map((s) => s.id),
    ).toEqual(["p2"]);
    expect(t.earlier.map((s) => s.id)).toEqual(["p2"]);
    expect(t.groupedSessionIds.has("p2")).toBe(true);
  });

  it("leaves pinned project sessions as plain rows in 置顶", () => {
    const t = buildSidebarTimeline(
      [
        session("pinned", 2, { projectId: "p", pinned: true }),
        session("p1", 0, { projectId: "p" }),
      ],
      [project("p")],
      { now: NOW },
    );
    expect(shape(t.items.pinned)).toEqual(["pinned"]);
    expect(shape(t.items.today)).toEqual(["p[p1]"]);
  });

  it("drops the group when every window session is pinned", () => {
    const t = buildSidebarTimeline(
      [session("pinned", 0, { projectId: "p", pinned: true })],
      [project("p")],
      { now: NOW },
    );
    expect(shape(t.items.pinned)).toEqual(["pinned"]);
    expect(t.items.today).toEqual([]);
  });

  it("puts a pinned project's group in 置顶", () => {
    const t = buildSidebarTimeline(
      [session("p1", 3, { projectId: "p" }), session("a", 1, { pinned: true })],
      [project("p", 90, { pinned: true })],
      { now: NOW },
    );
    expect(shape(t.items.pinned)).toEqual(["a", "p[p1]"]);
    expect(t.items.week).toEqual([]);
  });

  it("places an empty project by createdAt and hides it once old", () => {
    const t = buildSidebarTimeline(
      [],
      [project("fresh", 0), project("stale", 40)],
      { now: NOW },
    );
    expect(shape(t.items.today)).toEqual(["fresh[]"]);
    expect(t.items.month).toEqual([]);
  });

  it("gives a project with only old sessions no group", () => {
    const t = buildSidebarTimeline(
      [session("p1", 40, { projectId: "p" }), session("a", 1)],
      [project("p")],
      { now: NOW },
    );
    expect(shape(t.items.week)).toEqual(["a"]);
    expect(t.earlier.map((s) => s.id)).toEqual(["p1"]);
    expect(t.groupedSessionIds.has("p1")).toBe(false);
  });

  it("folds a single-session project too", () => {
    const t = buildSidebarTimeline(
      [
        session("solo", 0, { projectId: "s" }),
        session("q1", 0.1, { projectId: "q" }),
        session("q2", 0.2, { projectId: "q" }),
      ],
      [project("s"), project("q")],
      { now: NOW },
    );
    expect(shape(t.items.today)).toEqual(["s[solo]", "q[q1,q2]"]);
  });

  it("treats an unknown projectId as no project", () => {
    const t = buildSidebarTimeline(
      [session("orphan", 0, { projectId: "gone" })],
      [],
      { now: NOW },
    );
    expect(shape(t.items.today)).toEqual(["orphan"]);
  });

  it("folds backfilled project sessions too", () => {
    const t = buildSidebarTimeline(
      [
        session("p1", 40, { projectId: "p" }),
        session("a", 41),
        session("p2", 42, { projectId: "p" }),
      ],
      [project("p")],
      { now: NOW },
    );
    expect(shape(t.items.recent)).toEqual(["p[p1,p2]", "a"]);
    expect(t.earlier).toEqual([]);
  });

  it("finds the bucket of a session listed inside a group", () => {
    const t = buildSidebarTimeline(
      [
        session("p1", 0, { projectId: "p" }),
        session("p2", 45, { projectId: "p" }),
        session("old", 50),
      ],
      [project("p")],
      { now: NOW },
    );
    expect(findTimelineBucket(t, "p1")).toBe("today");
    expect(findTimelineBucket(t, "p2")).toBe("today");
    expect(findTimelineBucket(t, "old")).toBe("earlier");
    expect(findTimelineBucket(t, "missing")).toBeUndefined();
  });
});
