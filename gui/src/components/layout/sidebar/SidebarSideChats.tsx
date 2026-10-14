import { Tray } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import { PROJECT_GROUP_RECENT_COUNT } from "@/lib/sidebar-timeline";
import type { Project, Session } from "@/types/session";

import { SidebarProjectGroup } from "./SidebarProjectGroup";
import type { SidebarTimelineRowWiring } from "./SidebarTimelineRow";

/**
 * The managed runtime's sidebar, with a main chat (main chat tickets 07
 * / 08, 18; PRD rulings 32, 64), lists only what a person started in
 * its time buckets; the sessions an agent started outside a project
 * fold into one row, 「其他来源 N」, between the buckets and 更早.
 *
 * 「旁聊」 (side chat) is the PRD's and the code's word for the
 * conversations other than the main chat; the UI just says 对话.
 */

const OTHER_SOURCES_ID = "galley:other-sources";
const OTHER_SOURCES_ICON = { closed: Tray, open: Tray };

/**
 * 「其他来源 N」 (PRD ruling 32): the agent-started sessions outside
 * projects — CLI, supervisor, scheduled tasks — as one project-group
 * row, with the group's behaviour as is: collapsed by default (this
 * run only), a click opens it, the newest five then 显示更多, and while
 * collapsed the sessions erroring / waiting for a reply and the
 * selected one hang under the row. No + and no menu: it is not a
 * project. A tray, not a folder: things handed in from elsewhere.
 */
export function SidebarOtherSources({
  sessions,
  expanded,
  onToggleExpanded,
  ...rowWiring
}: {
  sessions: Session[];
  expanded: boolean;
  onToggleExpanded: () => void;
} & SidebarTimelineRowWiring) {
  const copy = useCopy();
  if (sessions.length === 0) return null;
  const newest = sessions[0].lastActivityAt;
  const group: Project = {
    id: OTHER_SOURCES_ID,
    name: copy.sidebar.otherSources,
    workspaceEnabled: false,
    pinned: false,
    lastActivityAt: newest,
    createdAt: newest,
    updatedAt: newest,
  };
  // pt-2: the 更早 entry's gap — the row closes the time buckets, it
  // is not the last bucket's last session.
  return (
    <div className="pt-2">
      <SidebarProjectGroup
        project={group}
        groupIcon={OTHER_SOURCES_ICON}
        sessions={sessions.slice(0, PROJECT_GROUP_RECENT_COUNT)}
        olderSessions={sessions.slice(PROJECT_GROUP_RECENT_COUNT)}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        {...rowWiring}
      />
    </div>
  );
}
