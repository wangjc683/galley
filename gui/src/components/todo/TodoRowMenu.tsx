import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  BellSimpleSlash,
  ChatTeardropText,
  DotsThree,
  Trash,
} from "@phosphor-icons/react";
import type { ReactElement } from "react";

import {
  MENU_CONTENT_CLASS,
  MENU_DELETE_CLASS,
  MENU_ITEM_CLASS,
} from "@/components/conversation/message-menu-styles";
import {
  SidebarRowMenuItem,
  type SidebarRowMenuKind,
  SidebarRowMenuSeparator,
} from "@/components/layout/sidebar/SidebarRowMenu";
import { IconButton } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";

/**
 * The menu of one of your to-dos not done (main chat ticket 88, PRD
 * ruling 132 point 3): 「说说这件」, 「取消提醒」 when it has a reminder
 * still to go off, a separator, 「删除」. Two ways in, one list, as the
 * message menu's (MessageMenu.tsx, rulings 85, 99, 105): a right-click
 * on the row (`TodoRowContextMenu`) and the ⋯ that ends the row's hover
 * actions (`TodoRowMenuButton`) — the ⋯ is 删除's way in for whoever
 * looks for it. 说说这件 and 取消提醒 are the row's own hover buttons
 * again, as your bubble's chips are its menu's 复制 and 引用. Drawn in
 * the message menu's register (message-menu-styles.ts) through the
 * sidebar's context / dropdown seam. Closing it moves no focus (说说这件
 * puts the caret in the composer), and Esc closes the menu alone, not
 * the panel.
 *
 * A memo's row on the 备忘 page (main chat ticket 97, PRD ruling 142
 * point 5) has the same menu with 「删除」 alone: no 说说这件 (a memo
 * is changed by telling Galley, from the composer), no separator.
 */

/** What a row's menu does, built by the row. */
export interface TodoRowMenuModel {
  /** 说说这件, first; none on a memo's row. */
  onTalkAbout?: () => void;
  /** 取消提醒 is on it: a reminder still to go off (`todoReminderCancellable`). */
  canCancelReminder?: boolean;
  onCancelReminder?: () => void;
  onDelete: () => void;
}

/** The rows, in either menu. */
function TodoRowMenuRows({
  kind,
  model,
}: {
  kind: SidebarRowMenuKind;
  model: TodoRowMenuModel;
}) {
  const copy = useCopy();
  const cancelReminder = model.canCancelReminder
    ? model.onCancelReminder
    : undefined;
  return (
    <>
      {model.onTalkAbout && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={model.onTalkAbout}
          className={MENU_ITEM_CLASS}
        >
          <ChatTeardropText size={13} weight="thin" />
          {copy.todo.talkAbout}
        </SidebarRowMenuItem>
      )}
      {cancelReminder && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={cancelReminder}
          className={MENU_ITEM_CLASS}
        >
          <BellSimpleSlash size={13} weight="thin" />
          {copy.todo.cancelReminder}
        </SidebarRowMenuItem>
      )}
      {(model.onTalkAbout || cancelReminder) && (
        <SidebarRowMenuSeparator kind={kind} className="my-1 h-px bg-line" />
      )}
      <SidebarRowMenuItem
        kind={kind}
        onSelect={model.onDelete}
        className={MENU_DELETE_CLASS}
      >
        <Trash size={13} weight="thin" />
        {copy.todo.deleteTodo.menuItem}
      </SidebarRowMenuItem>
    </>
  );
}

/**
 * The right-click menu: `children` is the row's own element, made the
 * trigger, and marked `data-galley-context-menu-trigger` so the app's
 * guard against the webview's menu (useGlobalShortcuts) lets this one
 * open. `disabled` (a row ticked and holding its place) opens nothing
 * and leaves the guard to keep the webview's menu off; the wrapper stays
 * so the row is not mounted afresh, its box's focus and its strike's
 * transition kept.
 */
export function TodoRowContextMenu({
  model,
  disabled,
  onOpenChange,
  children,
}: {
  model: TodoRowMenuModel;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactElement;
}) {
  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <ContextMenu.Trigger
        asChild
        disabled={disabled}
        data-galley-context-menu-trigger={disabled ? undefined : ""}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          data-role="todo-row-menu"
          className={MENU_CONTENT_CLASS}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <TodoRowMenuRows kind="context" model={model} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * The ⋯ at the row's end: the panel's hover button (`IconButton`, 28px,
 * 14px glyph), 「更多」 for its name and tooltip, pressed while its menu
 * is open — the row keeps it in sight meanwhile (`open`). The menu opens
 * from its right edge, the panel's.
 */
export function TodoRowMenuButton({
  model,
  open,
  onOpenChange,
}: {
  model: TodoRowMenuModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = useCopy();
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <IconTooltip text={copy.common.more}>
        <DropdownMenu.Trigger asChild>
          <IconButton
            ariaLabel={copy.common.more}
            tooltip={false}
            active={open}
          >
            <DotsThree size={14} weight="bold" />
          </IconButton>
        </DropdownMenu.Trigger>
      </IconTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-role="todo-row-menu"
          align="end"
          sideOffset={6}
          className={MENU_CONTENT_CLASS}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <TodoRowMenuRows kind="dropdown" model={model} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
