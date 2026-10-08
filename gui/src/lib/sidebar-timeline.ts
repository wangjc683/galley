import { sortProjectsForNavigation } from "@/lib/projects";
import {
  backfillRecentSessions,
  bucketForTimestamp,
  type GroupedSessions,
  groupSessions,
} from "@/lib/sessions";
import type { Project, Session, SessionBucket } from "@/types/session";

/**
 * The sidebar list (2026-10-08, .scratch/sidebar-project-groups/PRD.md):
 * 置顶, then a 项目 section of project groups, then time buckets that
 * hold only sessions outside projects. Project Review is gone: a project
 * is one collapsible row in the section, so a Supervisor split of four
 * sessions — or a regression batch of nineteen — costs one row, and its
 * live states still surface on that row.
 *
 * Built over the existing session-level buckets (`groupSessions` +
 * `backfillRecentSessions`), so which sessions sit behind 更早 — the
 * entry's count and the EarlierDialog list — is exactly what it was
 * before projects got their section.
 */

/** Time buckets below 置顶. `earlier` collapses to the 更早 entry. */
export type SidebarTimeBucket = "today" | "week" | "month" | "recent";

export const SIDEBAR_TIME_BUCKETS: SidebarTimeBucket[] = [
  "today",
  "week",
  "month",
  "recent",
];

export interface SidebarProjectGroupItem {
  project: Project;
  /** The project's unpinned sessions inside the timeline window,
   * newest first. Empty for an empty project (its drawer shows the
   * 新建项目对话 CTA) or a pinned project whose sessions are all old. */
  sessions: Session[];
  /** The project's sessions behind 更早, newest first — the drawer's
   * trailing 「更早 N 个」 row. They also stay in `earlier`. */
  olderSessions: Session[];
}

export interface SidebarSections {
  /** Pinned sessions, project ones included (D2). */
  pinned: Session[];
  /** The 项目 section's groups (S3), pinned projects first, then by
   * content activity (S5, `sortProjectsForNavigation`). */
  projects: SidebarProjectGroupItem[];
  /** Time buckets with sessions outside projects only (S4). */
  buckets: Record<SidebarTimeBucket, Session[]>;
  /** Sessions behind the 更早 entry: the EarlierDialog list (a group's
   * older sessions are in here too). */
  earlier: Session[];
  /** Every session a project group lists (drawer or its 更早 tail). The
   * 更早 entry's borrowed "you are here" row skips these — their group
   * shows them. */
  groupedSessionIds: Set<string>;
}

export interface SidebarSectionsOptions {
  now?: Date;
}

/**
 * Build the sidebar sections.
 *
 *   - S3 / D2: a project lists its unpinned window sessions; pinned
 *     sessions stay plain rows in 置顶. The 项目 section holds a pinned
 *     project always, an empty project (no visible sessions) while its
 *     `createdAt` is inside the window, and any other project only while
 *     it lists a window session — so one whose window sessions are all
 *     pinned, or that only has old sessions, is left to the 项目 menu.
 *   - D3: every project folds, a single-session one too.
 *   - D4: a group lists its window sessions flat, newest first; its
 *     older sessions are the drawer's tail.
 *   - S4: time buckets carry no project sessions.
 *   - S5: pinned projects first, then by content activity — the same
 *     order as the 项目 menu.
 *
 * Sessions whose `projectId` names no known project stay plain rows.
 */
export function buildSidebarSections(
  sessions: Session[],
  projects: Project[],
  { now = new Date() }: SidebarSectionsOptions = {},
): SidebarSections {
  const buckets: GroupedSessions = backfillRecentSessions(
    groupSessions(sessions, now),
  );
  const projectIds = new Set(projects.map((p) => p.id));
  const projectOf = (s: Session) =>
    s.projectId && projectIds.has(s.projectId) ? s.projectId : undefined;

  type Draft = { listed: Session[]; older: Session[]; pinnedCount: number };
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
  // newest first.
  for (const bucket of SIDEBAR_TIME_BUCKETS) {
    for (const s of buckets[bucket]) {
      const projectId = projectOf(s);
      if (projectId) draftFor(projectId).listed.push(s);
    }
  }
  for (const s of buckets.earlier) {
    const projectId = projectOf(s);
    if (projectId) draftFor(projectId).older.push(s);
  }

  const listedProjects: SidebarProjectGroupItem[] = [];
  const groupedSessionIds = new Set<string>();
  for (const project of sortProjectsForNavigation(projects, sessions)) {
    const draft = drafts.get(project.id);
    const listed = draft?.listed ?? [];
    const older = draft?.older ?? [];
    const empty =
      !draft ||
      (listed.length === 0 && older.length === 0 && draft.pinnedCount === 0);
    const inSection = project.pinned
      ? true
      : empty
        ? bucketForTimestamp(project.createdAt, now) !== "earlier"
        : listed.length > 0;
    if (!inSection) continue;
    for (const s of listed) groupedSessionIds.add(s.id);
    for (const s of older) groupedSessionIds.add(s.id);
    listedProjects.push({ project, sessions: listed, olderSessions: older });
  }

  const timeBuckets = {} as Record<SidebarTimeBucket, Session[]>;
  for (const bucket of SIDEBAR_TIME_BUCKETS) {
    timeBuckets[bucket] = buckets[bucket].filter(
      (s) => !groupedSessionIds.has(s.id),
    );
  }
  return {
    pinned: buckets.pinned,
    projects: listedProjects,
    buckets: timeBuckets,
    earlier: buckets.earlier,
    groupedSessionIds,
  };
}

/** Section holding `sessionId` — a bucket, or "projects" when a project
 * group lists it — or `undefined` when the sidebar doesn't list it. */
export function findSectionsSlot(
  sections: SidebarSections,
  sessionId: string,
): SessionBucket | "projects" | undefined {
  if (sections.pinned.some((s) => s.id === sessionId)) return "pinned";
  if (
    sections.projects.some(
      (item) =>
        item.sessions.some((s) => s.id === sessionId) ||
        item.olderSessions.some((s) => s.id === sessionId),
    )
  ) {
    return "projects";
  }
  for (const bucket of SIDEBAR_TIME_BUCKETS) {
    if (sections.buckets[bucket].some((s) => s.id === sessionId)) {
      return bucket;
    }
  }
  return sections.earlier.some((s) => s.id === sessionId)
    ? "earlier"
    : undefined;
}
