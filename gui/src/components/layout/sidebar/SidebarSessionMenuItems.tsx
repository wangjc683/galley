import {
  Archive,
  CaretRight,
  Check,
  Folder,
  FolderPlus,
  Pencil,
  PushPin,
  PushPinSlash,
  X as XIcon,
} from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Project, Session } from "@/types/session";

import {
  SidebarRowMenuItem,
  type SidebarRowMenuKind,
  SidebarRowMenuPortal,
  SidebarRowMenuSeparator,
  SidebarRowMenuSub,
  SidebarRowMenuSubContent,
  SidebarRowMenuSubTrigger,
} from "./SidebarRowMenu";

/**
 * Shared menu body for a session row — rendered inside both the
 * right-click ContextMenu and the ⋯ DropdownMenu (the `kind` prop
 * routes each item to the matching Radix primitive via SidebarRowMenu).
 * Pin / Rename / Move-to-project / Archive; each entry is gated on its
 * handler so a caller that doesn't wire an action simply omits it.
 *
 * Pin leads (2026-09-16): JC's own database had 0 of 111 sessions
 * pinned, read as a discoverability gap rather than no demand. A
 * dedicated hover pin button on the row (the reference conversation
 * list pattern) was weighed and declined — the row's hover slot is
 * the ⋯ target and pinning is a once-per-session action — so the
 * promotion is the cheapest one: first item in the menu both entry
 * points share.
 *
 * The project submenu (2026-10-09) reads 移到项目 once the session has a
 * project, and — when the host wires `onCreateProjectForSession` — ends
 * in 新建项目… so zero projects is no longer a dead end: the submenu is
 * then that one item instead of 「还没有项目」.
 */
export function SidebarSessionMenuItems({
  kind,
  session,
  projects,
  onArchive,
  onTogglePin,
  onAssignToProject,
  onCreateProjectForSession,
  onRequestRename,
}: {
  kind: SidebarRowMenuKind;
  session: Session;
  projects: Project[];
  onArchive?: () => void;
  onTogglePin?: () => void;
  onAssignToProject?: (projectId: string | null) => void;
  /** Submenu → 新建项目…: create a project and move this session in. */
  onCreateProjectForSession?: () => void;
  onRequestRename?: () => void;
}) {
  const copy = useCopy();
  // rounded-callout (8px) = the menu surface's rounded-md (12px) minus
  // its p-1 (4px) — concentric nested corners (polish-checklist P1).
  const itemClass = cn(
    "flex items-center gap-2 rounded-callout px-2.5 py-1.5 text-[13px] text-ink-soft outline-none",
    "data-[highlighted]:bg-hover data-[highlighted]:text-ink",
  );

  return (
    <>
      {onTogglePin && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={onTogglePin}
          className={itemClass}
        >
          {session.pinned ? (
            <>
              <PushPinSlash size={13} weight="thin" />
              {copy.sidebar.unpin}
            </>
          ) : (
            <>
              <PushPin size={13} weight="thin" />
              {copy.sidebar.pin}
            </>
          )}
        </SidebarRowMenuItem>
      )}
      {onRequestRename && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={onRequestRename}
          className={itemClass}
        >
          <Pencil size={13} weight="thin" />
          {copy.sidebar.rename}
        </SidebarRowMenuItem>
      )}
      {onAssignToProject && (
        <SidebarRowMenuSub kind={kind}>
          <SidebarRowMenuSubTrigger
            kind={kind}
            className={cn(
              itemClass,
              "data-[state=open]:bg-hover data-[state=open]:text-ink",
            )}
          >
            <Folder size={13} weight="thin" />
            {session.projectId
              ? copy.sidebar.moveToProject
              : copy.sidebar.addToProject}
            <CaretRight
              size={10}
              weight="thin"
              className="ml-auto text-ink-muted"
            />
          </SidebarRowMenuSubTrigger>
          <SidebarRowMenuPortal kind={kind}>
            <SidebarRowMenuSubContent
              kind={kind}
              className="galley-pop-in z-50 min-w-[200px] rounded-md border border-line bg-elevated p-1 shadow-elevated"
              sideOffset={4}
            >
              {/* With 新建项目… wired, that item alone fills an empty
                  submenu. */}
              {projects.length === 0 && !onCreateProjectForSession && (
                <div className="px-2.5 py-1.5 text-[12px] italic text-ink-muted">
                  {copy.sidebar.noProjects}
                </div>
              )}
              {projects.map((p) => {
                const isCurrent = session.projectId === p.id;
                return (
                  <SidebarRowMenuItem
                    key={p.id}
                    kind={kind}
                    onSelect={() => onAssignToProject(p.id)}
                    disabled={isCurrent}
                    className={cn(
                      itemClass,
                      "data-[disabled]:cursor-default data-[disabled]:opacity-50",
                    )}
                  >
                    <Folder size={13} weight="thin" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {isCurrent && (
                      <Check
                        size={11}
                        weight="bold"
                        className="text-brand-strong"
                      />
                    )}
                  </SidebarRowMenuItem>
                );
              })}
              {/* One separator closes the project list; 新建项目… and
                  从项目移除 share it. */}
              {projects.length > 0 &&
                (onCreateProjectForSession || session.projectId) && (
                  <SidebarRowMenuSeparator
                    kind={kind}
                    className="my-1 h-px bg-line"
                  />
                )}
              {onCreateProjectForSession && (
                <SidebarRowMenuItem
                  kind={kind}
                  onSelect={onCreateProjectForSession}
                  className={itemClass}
                >
                  <FolderPlus size={13} weight="thin" />
                  {copy.sidebar.newProjectForSession}
                </SidebarRowMenuItem>
              )}
              {session.projectId && (
                <SidebarRowMenuItem
                  kind={kind}
                  onSelect={() => onAssignToProject(null)}
                  className={itemClass}
                >
                  <XIcon size={13} weight="thin" />
                  {copy.sidebar.removeFromProject}
                </SidebarRowMenuItem>
              )}
            </SidebarRowMenuSubContent>
          </SidebarRowMenuPortal>
        </SidebarRowMenuSub>
      )}
      {onArchive && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={onArchive}
          className={itemClass}
        >
          <Archive size={13} weight="thin" />
          {copy.sidebar.archive}
        </SidebarRowMenuItem>
      )}
    </>
  );
}
