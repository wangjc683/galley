import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Folder, FolderOpen, Plus, PushPin } from "@phosphor-icons/react";
import { forwardRef, type ButtonHTMLAttributes, useRef, useState } from "react";

import {
  STATUS_MENU_CONTENT,
  STATUS_MENU_ITEM,
  STATUS_MENU_ROW,
  STATUS_MENU_SEPARATOR,
} from "@/components/layout/header/status-menu";
import { TopBarIconButton } from "@/components/layout/TopBarIconButton";
import { IconTooltip } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/session";

/**
 * The 项目 icon (2026-10-08): a menu, no longer the Project Review
 * toggle — projects live in the sidebar's 项目 section now. Same compact
 * menu grammar as the topbar lamps (header/status-menu.ts): 新建项目,
 * a separator, then every project (pinned first, then by content
 * activity). Picking a project starts a new chat in it and opens its
 * group (`onOpenProject`). A project gone quiet past 更早 has no group,
 * so this list is where it can still be reached.
 *
 * Renders in both icon-group copies (header / new-chat row); the
 * hidden copy is display:none.
 */
export function SidebarProjectsMenu({
  placement,
  projects,
  onNewProject,
  onOpenProject,
}: {
  placement: "header" | "row";
  projects: Project[];
  onNewProject?: () => void;
  onOpenProject?: (id: string) => void;
}) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  // Both kinds of item hand focus elsewhere (CreateProjectDialog, the
  // empty composer); returning it to the trigger as the menu closes
  // would pull it back.
  const focusHandedOffRef = useRef(false);
  const Icon = open ? FolderOpen : Folder;
  const label = copy.sidebar.projects;
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <IconTooltip text={label} side="bottom">
        <DropdownMenu.Trigger asChild>
          {placement === "header" ? (
            <TopBarIconButton aria-label={label}>
              <Icon size={16} weight="thin" />
            </TopBarIconButton>
          ) : (
            <RowMenuTrigger aria-label={label}>
              <Icon size={14} weight="thin" />
            </RowMenuTrigger>
          )}
        </DropdownMenu.Trigger>
      </IconTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onCloseAutoFocus={(event) => {
            if (focusHandedOffRef.current) {
              focusHandedOffRef.current = false;
              event.preventDefault();
            }
          }}
          className={cn(
            STATUS_MENU_CONTENT,
            "max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto",
          )}
        >
          {onNewProject && (
            <DropdownMenu.Item
              onSelect={() => {
                focusHandedOffRef.current = true;
                onNewProject();
              }}
              className={STATUS_MENU_ITEM}
            >
              <Plus
                size={14}
                weight="regular"
                className="shrink-0 text-ink-muted"
              />
              {copy.sidebar.newProject}
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className={STATUS_MENU_SEPARATOR} />
          {projects.length === 0 ? (
            <div className={cn(STATUS_MENU_ROW, "text-ui-meta text-ink-muted")}>
              {copy.sidebar.noProjects}
            </div>
          ) : (
            projects.map((project) => (
              <DropdownMenu.Item
                key={project.id}
                onSelect={() => {
                  focusHandedOffRef.current = true;
                  onOpenProject?.(project.id);
                }}
                className={STATUS_MENU_ITEM}
              >
                <Folder
                  size={14}
                  weight="thin"
                  className="shrink-0 text-ink-muted"
                />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {project.pinned && (
                  <PushPin
                    size={10}
                    weight="fill"
                    className="shrink-0 text-ink-muted"
                    aria-label={copy.sidebar.pin}
                  />
                )}
              </DropdownMenu.Item>
            ))
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The new-chat row's 32px icon button (SidebarNavIcons'
 * QuickIconButton) as a menu trigger: forwards ref + Radix props, and
 * holds the hover look while its menu is open. */
const RowMenuTrigger = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function RowMenuTrigger({ className, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "relative inline-flex size-8 items-center justify-center rounded-sm",
        "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm active:translate-y-px",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        "text-ink-soft hover:bg-hover hover:text-ink active:bg-selected/60",
        "aria-expanded:bg-hover aria-expanded:text-ink",
        className,
      )}
      {...rest}
    />
  );
});
