import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Copy,
  DotsThree,
  FloppyDisk,
  Footprints,
  Quotes,
  Trash,
} from "@phosphor-icons/react";
import {
  createContext,
  useContext,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { ActionChip } from "@/components/conversation/ActionChip";
import {
  SidebarRowMenuItem,
  type SidebarRowMenuKind,
  SidebarRowMenuSeparator,
} from "@/components/layout/sidebar/SidebarRowMenu";
import { useCopy } from "@/lib/i18n";
import type { MessageMenuAction, MessageMenuEntry } from "@/lib/message-menu";
import { cn } from "@/lib/utils";

/**
 * A bubble's message menu in the assistant's conversation (main chat
 * ticket 38, PRD ruling 85; the list is lib/message-menu.ts): right-click
 * a bubble (`MessageContextMenu`, one menu on the conversation's root), or
 * the ⋯ that ends a reply's action bar (`MessageMenuButton`; the bar's 引用
 * runs the menu's own, `MessageQuoteButton`, ticket 47). Both draw
 * the same rows from the same model (`MessageMenuRows`, through the
 * sidebar's context / dropdown seam), in the sidebar row menus' register
 * (`galley-pop-in`, 200px, 13px). Your bubble's row (ticket 53, PRD
 * ruling 105, overturning ruling 73's 「right-click only」) takes the same
 * two: its 引用 and its ⋯, after its copy (MessageUser). Closing either
 * menu moves no focus, and Esc closes only the menu, so a selection in
 * the conversation and its floating copy and quote stay as they were.
 */

/** A bubble's menu, built when it opens. */
export interface MessageMenuModel {
  entries: MessageMenuEntry[];
  onSelect: (action: MessageMenuAction) => void;
}

/** What the conversation hands its menus (Conversation builds it). */
export interface MessageMenuWiring {
  /** Whether row `messageId` is a bubble with a menu (cheap: the ⋯ asks
   * on every render). */
  has: (messageId: string) => boolean;
  /** Whether that menu has 引用 — the same judgment as the menu's item
   * (lib/message-menu `canQuoteMessage`), cheap enough for the bar's 引用
   * to ask on every render (the quote is kept per turn). Implies `has`. */
  canQuote: (messageId: string) => boolean;
  /** The menu of row `messageId`'s bubble, now; null when it has none. */
  model: (messageId: string) => MessageMenuModel | null;
}

const MessageMenuContext = createContext<MessageMenuWiring | null>(null);

/** The assistant's conversation's menus, for every ⋯ under it. Absent
 * everywhere else (the workbench, a subtask): no ⋯, no right-click menu. */
export function MessageMenuProvider({
  value,
  children,
}: {
  value: MessageMenuWiring;
  children: ReactNode;
}) {
  return (
    <MessageMenuContext.Provider value={value}>
      {children}
    </MessageMenuContext.Provider>
  );
}

const CONTENT_CLASS =
  "galley-pop-in z-50 w-[200px] rounded-md border border-line bg-elevated p-1 shadow-elevated";

// rounded-callout (8px) = the menu surface's rounded-md (12px) minus its
// p-1 (4px), as the sidebar's rows.
const ITEM_CLASS = cn(
  "flex items-center gap-2 rounded-callout px-2.5 py-1.5 text-[13px] text-ink-soft outline-none",
  "data-[highlighted]:bg-hover data-[highlighted]:text-ink",
);

const DELETE_CLASS = cn(
  "flex items-center gap-2 rounded-callout px-2.5 py-1.5 text-[13px] text-error outline-none",
  "data-[highlighted]:bg-error/[var(--opacity-soft)] data-[highlighted]:text-error",
  "data-[disabled]:text-ink-muted",
);

/** The rows of `model`, in either menu. 删除 greyed carries its reason
 * on a line under it; the rest stay usable. */
function MessageMenuRows({
  kind,
  model,
}: {
  kind: SidebarRowMenuKind;
  model: MessageMenuModel;
}) {
  const copy = useCopy();
  const words = copy.conversation;
  return (
    <>
      {model.entries.map((entry) => {
        switch (entry.kind) {
          case "separator":
            return (
              <SidebarRowMenuSeparator
                key="separator"
                kind={kind}
                className="my-1 h-px bg-line"
              />
            );
          case "delete": {
            const reason =
              entry.block === "running"
                ? words.deleteMessage.blockedRunning
                : entry.block === "asking"
                  ? words.deleteMessage.blockedAsking
                  : entry.block === "subtasks"
                    ? words.deleteMessage.blockedSubtasks
                    : null;
            return (
              <div key="delete">
                <SidebarRowMenuItem
                  kind={kind}
                  disabled={reason !== null}
                  onSelect={() => model.onSelect("delete")}
                  className={DELETE_CLASS}
                >
                  <Trash size={13} weight="thin" />
                  {words.deleteMessage.menuItem}
                </SidebarRowMenuItem>
                {reason && (
                  <div className="px-2.5 pb-1.5 text-[12px] leading-snug text-ink-muted">
                    {reason}
                  </div>
                )}
              </div>
            );
          }
          default:
            return (
              <SidebarRowMenuItem
                key={entry.kind}
                kind={kind}
                onSelect={() => model.onSelect(entry.kind)}
                className={ITEM_CLASS}
              >
                {entry.kind === "copy" ? (
                  <>
                    <Copy size={13} weight="thin" />
                    {words.copy}
                  </>
                ) : entry.kind === "quote" ? (
                  <>
                    <Quotes size={13} weight="thin" />
                    {words.quoteSelection}
                  </>
                ) : entry.kind === "save" ? (
                  <>
                    <FloppyDisk size={13} weight="thin" />
                    {words.save}
                  </>
                ) : (
                  <>
                    <Footprints size={13} weight="thin" />
                    {entry.open ? words.foldCollapse : words.foldExpand}
                  </>
                )}
              </SidebarRowMenuItem>
            );
        }
      })}
    </>
  );
}

/**
 * The right-click menu: one for the whole conversation — its trigger is
 * the conversation's root — that opens only on a bubble. The row a
 * right-click lands in (`data-message-id`) names it; anywhere else the
 * click opens nothing (the webview's own menu stays off,
 * layout-and-chrome「WebView 默认右键菜单」). A menu inside a bubble (a
 * file path, an image) opens instead of this one. Without the
 * conversation's wiring (`MessageMenuProvider`), the root as it is.
 */
export function MessageContextMenu({
  children,
}: {
  /** The conversation's root element. */
  children: ReactElement;
}) {
  const wiring = useContext(MessageMenuContext);
  const [target, setTarget] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (!wiring) return children;

  const onContextMenu = (event: MouseEvent) => {
    // A menu inside the bubble took it.
    if (event.defaultPrevented) return;
    const row =
      event.target instanceof Element
        ? event.target.closest("[data-message-id]")
        : null;
    const id = row?.getAttribute("data-message-id");
    if (!id || !wiring.has(id)) {
      // No bubble: no menu, and not the webview's either.
      event.preventDefault();
      return;
    }
    setTarget(id);
  };

  // Built while open, from the conversation as it is now.
  const model = open && target ? wiring.model(target) : null;
  return (
    <ContextMenu.Root onOpenChange={setOpen}>
      <ContextMenu.Trigger asChild onContextMenu={onContextMenu}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          data-role="message-menu"
          className={CONTENT_CLASS}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // Esc closes the menu and nothing else: the selection's own Esc
          // (SelectionCopyToolbar, on the document) would clear it.
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          {model && <MessageMenuRows kind="context" model={model} />}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * 引用 on a reply's action bar (main chat ticket 47, PRD ruling 99): the
 * menu's 引用 one click away, the same action — the click runs the
 * menu's own (`wiring.model(…).onSelect("quote")`: the whole reply into
 * the composer's quote strip, cut short when long, `wholeMessageQuote`),
 * so the two never drift. A chip of the bar's own (24px, 14px thin
 * Phosphor `Quotes` as on the menu and the selection's chip,
 * `tabIndex={-1}`), 「引用」 for its name and tooltip. No check flash:
 * the quote strip appearing and the caret in the composer are the
 * receipt. It shows exactly where the menu has 引用 (`wiring.canQuote`,
 * the menu's own judgment): not where the reply has no menu, as the ⋯,
 * nor under a reply with nothing to quote (an image alone). The row
 * under your bubble has it too (ticket 53), the same way: your words
 * whole, cut short when long.
 */
export function MessageQuoteButton({
  messageId,
  revealed,
}: {
  /** The bubble's row: a reply's answer row, or your message's. */
  messageId: string;
  /** The row under your bubble shows and hides its chips itself
   * (ActionChip `revealed`); a reply's bar hides as a whole. */
  revealed?: boolean;
}) {
  const copy = useCopy();
  const wiring = useContext(MessageMenuContext);
  if (!wiring || !wiring.canQuote(messageId)) return null;
  return (
    <ActionChip
      active={false}
      idleIcon={<Quotes size={14} weight="thin" />}
      activeIcon={<Quotes size={14} weight="thin" />}
      idleLabel={copy.conversation.quoteSelection}
      activeLabel={copy.conversation.quoteSelection}
      onClick={() => wiring.model(messageId)?.onSelect("quote")}
      revealed={revealed}
    />
  );
}

/**
 * The ⋯ that ends a reply's action bar: the same menu, for whoever looks
 * for it rather than right-clicking. A chip of the bar's own (24px,
 * `tabIndex={-1}`), 「更多」 for its name and tooltip, pressed while the
 * menu is open; the bar holds it (`open` keeps the bar up). Nothing
 * where the reply has no menu (outside the assistant's conversation, a
 * reply drawn the workbench way). It also ends the row under your
 * bubble (ticket 53), where the menu opens from its right edge (`align
 * "end"`): that row sits on the right, flush with the bubble.
 */
export function MessageMenuButton({
  messageId,
  open,
  onOpenChange,
  revealed,
  align = "start",
}: {
  /** The bubble's row: a reply's answer row, or your message's. */
  messageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row under your bubble shows and hides its chips itself
   * (ActionChip `revealed`); a reply's bar hides as a whole. */
  revealed?: boolean;
  /** The menu's edge on the ⋯: its left under a reply (the bar is on
   * the left), its right under your bubble. */
  align?: "start" | "end";
}) {
  const copy = useCopy();
  const wiring = useContext(MessageMenuContext);
  if (!wiring || !wiring.has(messageId)) return null;
  const model = open ? wiring.model(messageId) : null;
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <ActionChip
          active={false}
          expanded={open}
          idleIcon={<DotsThree size={14} weight="bold" />}
          activeIcon={<DotsThree size={14} weight="bold" />}
          idleLabel={copy.common.more}
          activeLabel={copy.common.more}
          revealed={revealed}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-role="message-menu"
          align={align}
          sideOffset={6}
          className={CONTENT_CLASS}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          {model && <MessageMenuRows kind="dropdown" model={model} />}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
