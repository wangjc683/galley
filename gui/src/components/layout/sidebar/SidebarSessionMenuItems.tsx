import {
  Archive,
  CaretRight,
  Check,
  Folder,
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
 * Rename / Pin / Move-to-project / Archive; each entry is gated on its
 * handler so a caller that doesn't wire an action simply omits it.
 */
export function SidebarSessionMenuItems({
  kind,
  session,
  projects,
  onArchive,
  onTogglePin,
  onAssignToProject,
  onRequestRename,
}: {
  kind: SidebarRowMenuKind;
  session: Session;
  projects: Project[];
  onArchive?: () => void;
  onTogglePin?: () => void;
  onAssignToProject?: (projectId: string | null) => void;
  onRequestRename?: () => void;
}) {
  const copy = useCopy();
  const itemClass = cn(
    "flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-[13px] text-ink-soft outline-none",
    "data-[highlighted]:bg-hover data-[highlighted]:text-ink",
  );

  return (
    <>
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
            {copy.sidebar.addToProject}
            <CaretRight
              size={10}
              weight="thin"
              className="ml-auto text-ink-muted"
            />
          </SidebarRowMenuSubTrigger>
          <SidebarRowMenuPortal kind={kind}>
            <SidebarRowMenuSubContent
              kind={kind}
              className="z-50 min-w-[200px] rounded-md border border-line bg-elevated p-1 shadow-elevated"
              sideOffset={4}
            >
              {projects.length === 0 ? (
                <div className="px-2.5 py-1.5 text-[12px] italic text-ink-muted">
                  {copy.sidebar.noProjects}
                </div>
              ) : (
                projects.map((p) => {
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
                })
              )}
              {session.projectId && (
                <>
                  <SidebarRowMenuSeparator
                    kind={kind}
                    className="my-1 h-px bg-line"
                  />
                  <SidebarRowMenuItem
                    kind={kind}
                    onSelect={() => onAssignToProject(null)}
                    className={itemClass}
                  >
                    <XIcon size={13} weight="thin" />
                    {copy.sidebar.removeFromProject}
                  </SidebarRowMenuItem>
                </>
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
