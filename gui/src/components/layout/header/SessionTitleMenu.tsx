import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowsClockwise,
  CaretDown,
  Cat,
  PencilSimple,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { SessionTitleEditor } from "../SessionTitleEditor";

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
 */
export function SessionTitleMenu({
  title,
  onReinjectTools,
  onTogglePet,
  currentSessionHasPet,
  onRename,
}: {
  title: string;
  onReinjectTools?: () => void;
  onTogglePet?: () => void;
  currentSessionHasPet?: boolean;
  onRename?: (newTitle: string) => void;
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
            "group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1",
            "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm hover:bg-hover data-[state=open]:bg-hover active:translate-y-[0.5px]",
            "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          <span className="truncate font-medium text-ink">{title}</span>
          <CaretDown
            size={11}
            weight="bold"
            className={cn(
              "shrink-0 text-ink-muted transition-transform duration-(--motion-fast)",
              "group-hover:text-ink-soft",
              "group-data-[state=open]:rotate-180 group-data-[state=open]:text-ink-soft",
            )}
          />
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
          {onRename && (
            <>
              <DropdownMenu.Item
                onSelect={beginRename}
                className={cn(
                  "flex items-center gap-2 rounded-sm px-2 py-1.5 outline-none",
                  "data-[highlighted]:bg-hover",
                )}
              >
                <PencilSimple
                  size={14}
                  weight="thin"
                  className="text-ink-soft"
                />
                <span>{copy.topbar.rename}</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
            </>
          )}
          <DropdownMenu.Item
            onSelect={() => onReinjectTools?.()}
            className={cn(
              "flex items-center gap-2 rounded-sm px-2 py-1.5 outline-none",
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
              "flex items-center gap-2 rounded-sm px-2 py-1.5 outline-none",
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
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
