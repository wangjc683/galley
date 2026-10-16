import * as ContextMenu from "@radix-ui/react-context-menu";
import { Trash } from "@phosphor-icons/react";
import { useState, type MouseEvent, type ReactElement } from "react";

import { useCopy } from "@/lib/i18n";
import type {
  DeletableMessage,
  MessageDeleteBlock,
} from "@/lib/message-delete";
import { cn } from "@/lib/utils";

/** What the menu needs from the conversation it wraps. */
export interface MessageDeleteMenuWiring {
  /** The bubble a right-click on row `messageId` names, or null when it
   * names none (lib/message-delete `deletableMessage`). */
  resolve: (messageId: string) => DeletableMessage | null;
  /** Why it cannot be deleted right now, or null. */
  block: (message: DeletableMessage) => MessageDeleteBlock | null;
  /** 删除 was chosen: confirm, then delete. */
  onDelete: (messageId: string) => void;
}

/**
 * The right-click menu of the assistant's conversation (main chat ticket
 * 32): one item, 删除, in the destructive style, greyed with the reason
 * under it while the main chat runs or waits for an answer, and for a
 * reply with subtask cards under it. One menu for the whole conversation
 * — its trigger is the conversation's root — that opens only on a
 * bubble: the row a right-click lands in (`data-message-id`) is resolved
 * by the caller, and anywhere else the click opens nothing (the webview's
 * own menu stays off, layout-and-chrome「WebView 默认右键菜单」). A menu
 * inside a bubble (a file path, an image) opens instead of this one.
 * Visual register of the sidebar's row menus (`galley-pop-in`, 200px,
 * 13px). Closing it moves no focus, and Esc closes only the menu, so a
 * selection in the conversation and its floating copy and quote stay as
 * they were.
 */
export function MessageDeleteMenu({
  children,
  resolve,
  block,
  onDelete,
}: MessageDeleteMenuWiring & {
  /** The conversation's root element. */
  children: ReactElement;
}) {
  const copy = useCopy().conversation.deleteMessage;
  const [target, setTarget] = useState<{
    messageId: string;
    block: MessageDeleteBlock | null;
  } | null>(null);

  const onContextMenu = (event: MouseEvent) => {
    // A menu inside the bubble took it.
    if (event.defaultPrevented) return;
    const row =
      event.target instanceof Element
        ? event.target.closest("[data-message-id]")
        : null;
    const id = row?.getAttribute("data-message-id");
    const message = id ? resolve(id) : null;
    if (!message) {
      // No bubble: no menu, and not the webview's either.
      event.preventDefault();
      return;
    }
    setTarget({ messageId: message.messageId, block: block(message) });
  };

  const reason =
    target?.block === "running"
      ? copy.blockedRunning
      : target?.block === "asking"
        ? copy.blockedAsking
        : target?.block === "subtasks"
          ? copy.blockedSubtasks
          : null;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild onContextMenu={onContextMenu}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          data-role="message-menu"
          className="galley-pop-in z-50 w-[200px] rounded-md border border-line bg-elevated p-1 shadow-elevated"
          onCloseAutoFocus={(event) => event.preventDefault()}
          // Esc closes the menu and nothing else: the selection's own Esc
          // (SelectionCopyToolbar, on the document) would clear it.
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <ContextMenu.Item
            disabled={reason !== null}
            onSelect={() => {
              if (target) onDelete(target.messageId);
            }}
            className={cn(
              "flex items-center gap-2 rounded-callout px-2.5 py-1.5 text-[13px] text-error outline-none",
              "data-[highlighted]:bg-error/[var(--opacity-soft)] data-[highlighted]:text-error",
              "data-[disabled]:text-ink-muted",
            )}
          >
            <Trash size={13} weight="thin" />
            {copy.menuItem}
          </ContextMenu.Item>
          {reason && (
            <div className="px-2.5 pb-1.5 text-[12px] leading-snug text-ink-muted">
              {reason}
            </div>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
