import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowsClockwise,
  CaretDown,
  Cat,
  Eraser,
  MagnifyingGlass,
  PencilSimple,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ShortcutGlyphs } from "@/components/ui/shortcut-glyphs";
import { useCopy } from "@/lib/i18n";
import { formatShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

import { SessionTitleEditor } from "../SessionTitleEditor";
import { SHORTCUT_TEXT_CLASS } from "../sidebar/SidebarNavIcons";

const MENU_ITEM = cn(
  "flex items-center gap-2 rounded-callout px-2 py-1.5 outline-none",
  "data-[highlighted]:bg-hover",
);

/** The title button's caret: muted, a step up on hover, turned while
 * the menu is open. Reads the trigger's `group` state, so a custom
 * label can place it (the assistant's identity puts it after the name,
 * not after its status line). */
export function SessionTitleCaret() {
  return (
    <CaretDown
      size={11}
      weight="bold"
      className={cn(
        "shrink-0 text-ink-muted transition-transform duration-(--motion-fast)",
        "group-hover:text-ink-soft",
        "group-data-[state=open]:rotate-180 group-data-[state=open]:text-ink-soft",
      )}
    />
  );
}

/**
 * Title-as-dropdown trigger for session-scoped actions. The session
 * title text and a caret form a single button; clicking opens a menu
 * with low-frequency / power-user actions attached to "this current
 * session":
 *
 *   - Reinject Tools: one-shot — re-injects GA's
 *     tool definitions into the active session's LLM history.
 *   - Desktop Pet: 2-state toggle. Label is
 *     "关闭桌面宠物" when this session holds the pet and "桌面宠物"
 *     otherwise; clicking "桌面宠物" from a non-holder session
 *     implicitly migrates the pet here. "Where is the pet right
 *     now" lives in the Sidebar Cat badge, not in this label.
 *
 * Future V0.2 entries (`/branch`, `/rewind`) slot in here too — see
 * discussion thread 2026-05-13.
 *
 * Why title-as-trigger instead of a sibling `⋯` button: a bare title +
 * trailing dots reads as CSS text-overflow ellipsis. The whole-block
 * trigger removes that ambiguity and gives the rename affordance a
 * natural home (V0.1 #3).
 *
 * `label` replaces the title text and its caret inside the same button:
 * the assistant's identity row (avatar, name, status) while the main
 * chat is open (main chat ticket 18) — like tapping a contact's name in
 * an IM chat. It brings its own `SessionTitleCaret`, and the main chat
 * has no rename.
 *
 * Like an IM contact's profile page (main chat ticket 28, PRD ruling
 * 77: WeChat's 查找聊天记录 / 清空聊天记录), the menu opens with
 * 查找聊天记录… ⌘F — ⌘K's palette inside this conversation — and the
 * main chat's ends with 重置主对话…, Settings' hold-to-confirm dialog,
 * greyed with the reason while a conversation runs. The groups:
 *
 *   main chat:  查找 ─ 重新注入工具 / 桌面宠物 ─ 重置主对话
 *   others:     查找 / 重命名 ─ 重新注入工具 / 桌面宠物
 */
export function SessionTitleMenu({
  title,
  label,
  onFind,
  onReinjectTools,
  onTogglePet,
  currentSessionHasPet,
  onRename,
  onResetMainChat,
  resetMainChatBlocked = false,
}: {
  title: string;
  label?: ReactNode;
  /** 查找聊天记录…: the palette scoped to this conversation. */
  onFind?: () => void;
  onReinjectTools?: () => void;
  onTogglePet?: () => void;
  currentSessionHasPet?: boolean;
  onRename?: (newTitle: string) => void;
  /** 重置主对话…: only the main chat on the managed runtime has it. */
  onResetMainChat?: () => void;
  /** A conversation runs: the reset item is greyed, the reason under it. */
  resetMainChatBlocked?: boolean;
}) {
  const copy = useCopy();
  const petHere = !!currentSessionHasPet;
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const titleClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks whether the menu close was triggered by "重命名" so we can
  // suppress Radix's default focus-return-to-trigger (the trigger is
  // about to be replaced by the input). Without this, Radix focuses
  // the about-to-unmount button and the input never wins focus on
  // mount — user has to click again.
  const renameRequestedRef = useRef(false);
  // 查找聊天记录 and 重置主对话 open a modal that takes the focus (the
  // palette's input, the confirm's Cancel). Opened while the menu is
  // still up, that focus lands inside the menu's trap and is lost when
  // the menu goes; so the item files its action here and it runs once
  // the menu has closed, in place of the focus going back to the trigger.
  const afterCloseRef = useRef<(() => void) | null>(null);

  const clearTitleClickTimer = () => {
    if (!titleClickTimerRef.current) return;
    clearTimeout(titleClickTimerRef.current);
    titleClickTimerRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (titleClickTimerRef.current) {
        clearTimeout(titleClickTimerRef.current);
      }
    };
  }, []);

  const beginRename = () => {
    if (!onRename) return;
    clearTitleClickTimer();
    renameRequestedRef.current = true;
    setMenuOpen(false);
    setEditing(true);
  };

  if (editing && onRename) {
    return (
      <SessionTitleEditor
        initial={title}
        onCommit={(next) => {
          onRename(next);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
        dragRegionOptOut
        className="w-full max-w-[480px] rounded-md px-2 py-1"
      />
    );
  }

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={copy.topbar.moreConversationActions(title)}
          onPointerDown={(e) => {
            if (!onRename) return;
            if (e.button !== 0 || e.ctrlKey) return;
            e.preventDefault();
          }}
          onClick={(e) => {
            if (!onRename) return;
            if (e.detail > 1) {
              clearTitleClickTimer();
              return;
            }
            if (e.detail !== 1) return;
            clearTitleClickTimer();
            if (menuOpen) {
              setMenuOpen(false);
              return;
            }
            titleClickTimerRef.current = setTimeout(() => {
              setMenuOpen(true);
              titleClickTimerRef.current = null;
            }, 160);
          }}
          onDoubleClick={(e) => {
            if (!onRename) return;
            e.preventDefault();
            e.stopPropagation();
            beginRename();
          }}
          className={cn(
            "group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md",
            // The identity's 28px avatar and two lines get a slimmer
            // vertical pad, so its fill keeps clear of the 44px header's
            // edges; a little less on the left, where the disc is round.
            label ? "py-0.5 pl-1.5 pr-2 text-left" : "px-2 py-1",
            "transition-none active:transition-[translate,scale,box-shadow] active:duration-(--motion-press) active:ease-firm hover:bg-hover data-[state=open]:bg-hover active:translate-y-px",
            "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          {label ?? (
            <>
              <span className="truncate font-medium text-ink">{title}</span>
              <SessionTitleCaret />
            </>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="center"
          sideOffset={6}
          onCloseAutoFocus={(e) => {
            if (renameRequestedRef.current) {
              renameRequestedRef.current = false;
              e.preventDefault();
            }
            const afterClose = afterCloseRef.current;
            if (afterClose) {
              afterCloseRef.current = null;
              e.preventDefault();
              afterClose();
            }
          }}
          className={cn(
            // z-[70] is above the dev-toggle panel (z-[60] in
            // App.tsx) — without this, the menu opens BEHIND the
            // dev INTRO/EMPTY/MAIN/+toast/+mock buttons in dev mode.
            // Production build has no dev panel so z-50 would
            // suffice, but the higher value is harmless there.
            "z-[70] min-w-[200px] rounded-md border border-line bg-elevated p-1",
            "text-[13px] text-ink shadow-elevated",
          )}
        >
          {onFind && (
            <DropdownMenu.Item
              onSelect={() => {
                afterCloseRef.current = onFind;
              }}
              className={MENU_ITEM}
            >
              <MagnifyingGlass
                size={14}
                weight="thin"
                className="text-ink-soft"
              />
              <span>{copy.topbar.findInChat}</span>
              {/* The sidebar new-chat row's ⌘N hint; the item's text
                  is its name. */}
              <span
                aria-hidden="true"
                className={cn("ml-auto pl-6", SHORTCUT_TEXT_CLASS)}
              >
                <ShortcutGlyphs text={formatShortcut("Mod+F")} />
              </span>
            </DropdownMenu.Item>
          )}
          {onRename && (
            <DropdownMenu.Item
              onSelect={beginRename}
              className={cn(
                "flex items-center gap-2 rounded-callout px-2 py-1.5 outline-none",
                "data-[highlighted]:bg-hover",
              )}
            >
              <PencilSimple size={14} weight="thin" className="text-ink-soft" />
              <span>{copy.topbar.rename}</span>
            </DropdownMenu.Item>
          )}
          {(onFind || onRename) && (
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
          )}
          <DropdownMenu.Item
            onSelect={() => onReinjectTools?.()}
            className={cn(
              "flex items-center gap-2 rounded-callout px-2 py-1.5 outline-none",
              "data-[highlighted]:bg-hover",
            )}
          >
            <ArrowsClockwise
              size={14}
              weight="thin"
              className="text-ink-soft"
            />
            <span>{copy.topbar.reinjectTools}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => onTogglePet?.()}
            className={cn(
              "flex items-center gap-2 rounded-callout px-2 py-1.5 outline-none",
              "data-[highlighted]:bg-hover",
            )}
          >
            <Cat
              size={14}
              weight="thin"
              className={petHere ? "text-brand" : "text-ink-soft"}
            />
            <span className="text-ink">
              {petHere ? copy.topbar.closeDesktopPet : copy.topbar.desktopPet}
            </span>
          </DropdownMenu.Item>
          {onResetMainChat && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item
                disabled={resetMainChatBlocked}
                onSelect={() => {
                  afterCloseRef.current = onResetMainChat;
                }}
                className={cn(
                  MENU_ITEM,
                  "data-[disabled]:cursor-not-allowed",
                  resetMainChatBlocked && "items-start",
                )}
              >
                {/* Greyed like Settings' row (SettingsNavRow): the icon
                    and the name dim, the reason under them does not —
                    it is the one line worth reading. */}
                <Eraser
                  size={14}
                  weight="thin"
                  className={cn(
                    "shrink-0 text-ink-soft",
                    resetMainChatBlocked && "mt-[3px] opacity-60",
                  )}
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block",
                      resetMainChatBlocked && "opacity-60",
                    )}
                  >
                    {copy.topbar.resetMainChat}
                  </span>
                  {resetMainChatBlocked && (
                    <span
                      data-role="reset-main-chat-blocked"
                      className="mt-0.5 block max-w-[232px] text-ui-tertiary leading-notice text-ink-muted"
                    >
                      {copy.settings.runtime.resetMainChat.runningBlock}
                    </span>
                  )}
                </span>
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
