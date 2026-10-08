import {
  backfillRecentSessions,
  bucketForTimestamp,
  groupSessions,
} from "@/lib/sessions";
import type { Project, Session, SessionBucket } from "@/types/session";

/**
 * The sidebar timeline with project sessions folded into project groups
 * (2026-10-08, .scratch/sidebar-project-groups/PRD.md). Project Review
 * is gone: the one timeline carries projects as collapsible rows, so a
 * Supervisor split of four sessions — or a regression batch of nineteen —
 * costs one row, and its live states still surface on that row.
 *
 * The fold runs over the existing session-level buckets
 * (`groupSessions` + `backfillRecentSessions`), so which sessions sit
 * behind 更早 — the entry's count and the EarlierDialog list — is
 * exactly what it was before projects folded.
 */

/** Buckets that list rows inline. `earlier` collapses to the 更早 entry. */
export type SidebarInlineBucket = Exclude<SessionBucket, "earlier">;

export const SIDEBAR_INLINE_BUCKETS: SidebarInlineBucket[] = [
  "pinned",
  "today",
  "week",
  "month",
  "recent",
];

export type SidebarTimelineItem =
  | { kind: "session"; session: Session }
  | {
      kind: "project";
      project: Project;
      /** The project's unpinned sessions inside the timeline window,
       * newest first. Empty for an empty project (its drawer shows the
       * 新建项目对话 CTA) or a pinned project whose sessions are all old. */
      sessions: Session[];
      /** The project's sessions behind 更早, newest first — the drawer's
       * trailing 「更早 N 个」 row. They also stay in `earlier`. */
      olderSessions: Session[];
    };

export interface SidebarTimeline {
  items: Record<SidebarInlineBucket, SidebarTimelineItem[]>;
  /** Sessions behind the 更早 entry: the EarlierDialog list, unchanged
   * by folding (a group's older sessions are in here too). */
  earlier: Session[];
  /** Every session a project group lists (drawer or its 更早 tail). The
   * 更早 entry's borrowed "you are here" row skips these — their group
   * shows them. */
  groupedSessionIds: Set<string>;
}

export interface SidebarTimelineOptions {
  now?: Date;
}

const WINDOW_BUCKETS = ["today", "week", "month", "recent"] as const;

/**
 * Build the folded timeline.
 *
 *   - D1: a project appears once. Its group sits in the bucket of its
 *     most recent unpinned session in the window and sorts among the
 *     bucket's session rows by that session's activity. A pinned
 *     project's group sits in 置顶. An empty project (no visible
 *     sessions) is placed by `createdAt`; once that is older than the
 *     window it leaves the sidebar.
 *   - D2: pinned sessions stay plain rows in 置顶 even inside a
 *     project. A project whose window sessions are all pinned (or that
 *     only has old sessions) has no group.
 *   - D3: every project folds, a single-session one too — project
 *     sessions always sit under their project's row.
 *   - D4: a group lists its window sessions flat, newest first; its
 *     older sessions are the drawer's tail.
 *
 * Sessions whose `projectId` names no known project stay plain rows.
 */
export function buildSidebarTimeline(
  sessions: Session[],
  projects: Project[],
  { now = new Date() }: SidebarTimelineOptions = {},
): SidebarTimeline {
  const buckets = backfillRecentSessions(groupSessions(sessions, now));
  const projectIds = new Set(projects.map((p) => p.id));
  const projectOf = (s: Session) =>
    s.projectId && projectIds.has(s.projectId) ? s.projectId : undefined;

  type Draft = {
    listed: Session[];
    bucket?: SidebarInlineBucket;
    older: Session[];
    pinnedCount: number;
  };
  const drafts = new Map<string, Draft>();
  const draftFor = (projectId: string) => {
    let draft = drafts.get(projectId);
    if (!draft) {
      draft = { listed: [], older: [], pinnedCount: 0 };
      drafts.set(projectId, draft);
    }
    return draft;
  };
  for (const s of buckets.pinned) {
    const projectId = projectOf(s);
    if (projectId) draftFor(projectId).pinnedCount++;
  }
  // Window buckets in order, each newest first: `listed` comes out
  // newest first and `bucket` lands on the newest session's bucket.
  for (const bucket of WINDOW_BUCKETS) {
    for (const s of buckets[bucket]) {
      const projectId = projectOf(s);
      if (!projectId) continue;
      const draft = draftFor(projectId);
      draft.listed.push(s);
      draft.bucket ??= bucket;
    }
  }
  for (const s of buckets.earlier) {
    const projectId = projectOf(s);
    if (projectId) draftFor(projectId).older.push(s);
  }

  type Placed = { item: SidebarTimelineItem; at: string };
  const placed: Record<SidebarInlineBucket, Placed[]> = {
    pinned: [],
    today: [],
    week: [],
    month: [],
    recent: [],
  };
  const groupedSessionIds = new Set<string>();

  for (const project of projects) {
    const draft = drafts.get(project.id);
    const listed = draft?.listed ?? [];
    const older = draft?.older ?? [];
    const empty =
      !draft ||
      (listed.length === 0 && older.length === 0 && draft.pinnedCount === 0);
    let bucket: SidebarInlineBucket | undefined;
    let at: string;
    if (project.pinned) {
      bucket = "pinned";
      at =
        listed[0]?.lastActivityAt ??
        older[0]?.lastActivityAt ??
        project.createdAt;
    } else if (empty) {
      const createdBucket = bucketForTimestamp(project.createdAt, now);
      bucket = createdBucket === "earlier" ? undefined : createdBucket;
      at = project.createdAt;
    } else {
      // Set only when the project lists a window session.
      bucket = draft?.bucket;
      at = listed[0]?.lastActivityAt ?? project.createdAt;
    }
    if (!bucket) continue;
    for (const s of listed) groupedSessionIds.add(s.id);
    for (const s of older) groupedSessionIds.add(s.id);
    placed[bucket].push({
      item: {
        kind: "project",
        project,
        sessions: listed,
        olderSessions: older,
      },
      at,
    });
  }

  for (const bucket of SIDEBAR_INLINE_BUCKETS) {
    for (const s of buckets[bucket]) {
      if (groupedSessionIds.has(s.id)) continue;
      placed[bucket].push({
        item: { kind: "session", session: s },
        at: s.lastActivityAt,
      });
    }
  }

  const items = {} as Record<SidebarInlineBucket, SidebarTimelineItem[]>;
  for (const bucket of SIDEBAR_INLINE_BUCKETS) {
    // Stable sort: equal timestamps keep groups ahead of the rows the
    // loop above appended after them.
    items[bucket] = placed[bucket]
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((p) => p.item);
  }

  return { items, earlier: buckets.earlier, groupedSessionIds };
}

/** Bucket holding `sessionId` — its own row, or the row of the group
 * listing it — or `undefined` when the timeline doesn't list it. */
export function findTimelineBucket(
  timeline: SidebarTimeline,
  sessionId: string,
): SessionBucket | undefined {
  for (const bucket of SIDEBAR_INLINE_BUCKETS) {
    for (const item of timeline.items[bucket]) {
      if (item.kind === "session") {
        if (item.session.id === sessionId) return bucket;
      } else if (
        item.sessions.some((s) => s.id === sessionId) ||
        item.olderSessions.some((s) => s.id === sessionId)
      ) {
        return bucket;
      }
    }
  }
  return timeline.earlier.some((s) => s.id === sessionId)
    ? "earlier"
    : undefined;
}
