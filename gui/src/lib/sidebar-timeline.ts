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

/** How many of a project's sessions its open drawer shows before the
 * 「更早 N 个」 tail (2026-10-09, JC: K = 5). With several groups open
 * at once — three projects each with a session in flight — a group's
 * history no longer pushes the next group's live session off a small
 * screen. */
export const PROJECT_GROUP_RECENT_COUNT = 5;

export interface SidebarProjectGroupItem {
  project: Project;
  /** The project's newest unpinned sessions, at most
   * PROJECT_GROUP_RECENT_COUNT, newest first. Empty for an empty
   * project (its drawer shows the 新建项目对话 CTA). */
  sessions: Session[];
  /** The rest, newest first — the drawer's trailing 「更早 N 个」 row.
   * Those older than the window also stay in `earlier`. */
  olderSessions: Session[];
}

export interface SidebarSections {
  /** Pinned sessions, project ones included (D2). */
  pinned: Session[];
  /** The 项目 section's groups (S3), pinned projects first, then by
   * content activity (S5, `sortProjectsForNavigation`). */
  projects: SidebarProjectGroupItem[];
  /** Every other project — unpinned, gone quiet past the window, or an
   * empty one created before it — in the same order, behind the
   * section's closing 「其他项目 N」 row (2026-10-09; before, only the
   * masthead 项目 menu reached them). */
  otherProjects: SidebarProjectGroupItem[];
  /** Time buckets with sessions outside projects only (S4). */
  buckets: Record<SidebarTimeBucket, Session[]>;
  /** Sessions behind the 更早 entry: the EarlierDialog list (a group's
   * older sessions are in here too). */
  earlier: Session[];
  /** Every session a project group lists (drawer or its 更早 tail),
   * other projects' included. The 更早 entry's borrowed "you are here"
   * row skips these — their group, or the fold they hang under, shows
   * them. */
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
 *     it lists a window session. The rest — one whose window sessions
 *     are all pinned, or that only has old sessions — are
 *     `otherProjects`, behind the section's 「其他项目」 row.
 *   - D3: every project folds, a single-session one too.
 *   - D4: a group lists its newest PROJECT_GROUP_RECENT_COUNT sessions
 *     flat, newest first; the rest are the drawer's tail. (Which
 *     projects the section lists still goes by the window.)
 *   - S4: time buckets carry no project sessions.
 *   - S5: pinned projects first, then by content activity
 *     (`sortProjectsForNavigation`), in the section and behind
 *     其他项目 alike.
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
  const otherProjects: SidebarProjectGroupItem[] = [];
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
    for (const s of listed) groupedSessionIds.add(s.id);
    for (const s of older) groupedSessionIds.add(s.id);
    // listed (window) then older (更早), each newest first.
    const all = [...listed, ...older];
    (inSection ? listedProjects : otherProjects).push({
      project,
      sessions: all.slice(0, PROJECT_GROUP_RECENT_COUNT),
      olderSessions: all.slice(PROJECT_GROUP_RECENT_COUNT),
    });
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
    otherProjects,
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
    [...sections.projects, ...sections.otherProjects].some(
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

/** The sessions a project group's 归档全部对话 archives — its listed
 * sessions plus the 更早 tail's: unarchived, unpinned (pinned ones sit
 * in 置顶, outside the group). The delete-project dialog's
 * 「同时归档里面的 N 个对话」 uses the same set, so both counts agree. */
export function archivableProjectSessions(
  sessions: Session[],
  projectId: string,
): Session[] {
  return sessions.filter(
    (s) => s.projectId === projectId && !s.pinned && s.status !== "archived",
  );
}
