import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Gear, PuzzlePiece } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { TopBarIconButton } from "../TopBarIconButton";
import {
  type BrowserControlIndicatorInput,
  browserControlErrorRetries,
  browserControlIndicatorView,
} from "./browser-control-indicator-status";
import {
  STATUS_MENU_CONTENT,
  STATUS_MENU_ITEM,
  STATUS_MENU_ROW,
  STATUS_MENU_SEPARATOR,
} from "./status-menu";
import { TopBarLampIcon } from "./TopBarLampIcon";
import {
  TOPBAR_POPOVER_OPEN_STATE,
  topBarStatusBadgeClass,
} from "./topbar-status-badge";

/**
 * Browser Control in the status cluster (managed runtime only).
 *
 *   - Set up: a `PuzzlePiece` lamp, lit while the extension is connected
 *     to Core's resident bridge (live), unlit when it is not (browser
 *     closed). Click → a status menu (`status-menu.ts`) in the Channels
 *     menu's row grammar: the puzzle mark (dimmed when not live), 浏览器,
 *     the state word in the right-hand column; below, the tab count, the
 *     offline hint or the bridge's message; a separator, 设置….
 *     The scope line is not repeated here:
 *     a glance surface is reopened every time, and what Galley can see
 *     is read once, in Settings' connected card (2026-10-04, JC: the
 *     panel read long). No 重新检测: the state is live, so a manual
 *     check would only repeat what the bridge already reports.
 *   - Never set up: the 待解锁 badge in the brand tone — an invitation to
 *     Galley's headline capability, not a fault. Click → Settings →
 *     Browser Control directly; that is the only next step.
 *   - Bridge / probe failure: an error badge named by its cause; the
 *     menu row names the cause again in red and adds the bridge's own
 *     message below — no separate title restating the badge.
 */
export function BrowserControlIndicator({
  input,
  onOpenSettings,
}: {
  input: BrowserControlIndicatorInput;
  onOpenSettings?: () => void;
}) {
  const copy = useCopy().topbar;
  const [open, setOpen] = useState(false);
  // 设置… hands focus to the Settings dialog; returning it to the
  // trigger as the menu closes would pull it back out.
  const settingsRequestedRef = useRef(false);
  const view = browserControlIndicatorView(input);
  // A menu left open while the indicator turns into a plain badge
  // (an unverified install whose bridge error clears to 待解锁) must not
  // pop back open when the lamp returns.
  const hasMenu = view.form === "lamp" || view.form === "error";
  if (open && !hasMenu) setOpen(false);
  if (view.form === "hidden") return null;

  if (view.form === "pending") {
    return (
      <TooltipLabel text={copy.browserControlPendingTitle}>
        <button
          type="button"
          onClick={onOpenSettings}
          className={topBarStatusBadgeClass("brand")}
          aria-label={copy.browserControlPendingTitle}
        >
          {copy.browserControlPending}
        </button>
      </TooltipLabel>
    );
  }

  const popoverCopy = copy.browserControlPopover;
  const errorCopy =
    view.form === "error" && view.group !== "generic"
      ? copy.browserControlErrors[view.group]
      : null;
  const tooltip =
    view.form === "error"
      ? (errorCopy?.title ?? copy.browserControlErrorTitle)
      : {
          connected: copy.browserControlConnectedTitle,
          noTabs: copy.browserControlNoTabsTitle,
          offline: copy.browserControlOfflineTitle,
          checking: copy.browserControlChecking,
        }[view.state];
  const live =
    view.form === "lamp" &&
    (view.state === "connected" || view.state === "noTabs");
  // Offline and checking dim the mark and the name: the lamp's grammar
  // per row, as in the Channels menu.
  const dimmed = view.form === "lamp" && !live;
  const tabsLabel =
    view.form === "lamp" && view.state === "connected"
      ? popoverCopy.tabCount(input.tabCount)
      : view.form === "lamp" && view.state === "noTabs"
        ? popoverCopy.noTabs
        : null;
  // 已连接 in the restrained success green, the same word size and colour
  // as the Channels menu's 已接入 (JC, 2026-10-04).
  const stateWord =
    view.form === "error"
      ? (errorCopy?.state ?? popoverCopy.errorState)
      : {
          connected: popoverCopy.connected,
          noTabs: popoverCopy.connected,
          offline: popoverCopy.offlineState,
          checking: popoverCopy.checking,
        }[view.state];
  const stateClass =
    view.form === "error"
      ? "text-error"
      : live
        ? "text-success"
        : "text-ink-muted";
  const hint =
    view.form === "error"
      ? input.errorDetail
      : view.state === "offline"
        ? popoverCopy.offlineHint
        : null;
  // Bridge failures retry on their own; probe failures do not (rule
  // shared with Settings' error card).
  const retrying =
    view.form === "error" && browserControlErrorRetries(input.errorKind);
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <TooltipLabel text={tooltip} side="bottom">
        <DropdownMenu.Trigger asChild>
          {view.form === "lamp" ? (
            <TopBarIconButton aria-label={tooltip}>
              <TopBarLampIcon icon={PuzzlePiece} lit={view.lit} />
            </TopBarIconButton>
          ) : (
            <button
              type="button"
              aria-label={tooltip}
              className={topBarStatusBadgeClass(
                "error",
                TOPBAR_POPOVER_OPEN_STATE,
              )}
            >
              {errorCopy?.badge ?? copy.browserControlError}
            </button>
          )}
        </DropdownMenu.Trigger>
      </TooltipLabel>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          onCloseAutoFocus={(event) => {
            if (settingsRequestedRef.current) {
              settingsRequestedRef.current = false;
              event.preventDefault();
            }
          }}
          className={STATUS_MENU_CONTENT}
        >
          <div className={STATUS_MENU_ROW}>
            <div className="flex items-center gap-2">
              <PuzzlePiece
                size={14}
                weight="thin"
                aria-hidden
                className={cn("shrink-0 text-ink-soft", dimmed && "opacity-50")}
              />
              <div className="flex min-w-0 flex-1 items-baseline justify-between gap-4">
                <span className={cn(dimmed && "text-ink-soft")}>
                  {popoverCopy.name}
                </span>
                <span className={cn("shrink-0 text-ui-meta", stateClass)}>
                  {stateWord}
                </span>
              </div>
            </div>
            {/* Below the row, indented to the name column: the tab count
                (a second line rather than beside the name — JC's live pick
                on 2026-10-04), the offline hint, or the bridge's message,
                which may widen the menu up to its 300px cap and is clamped
                at two lines: Settings shows it in full. */}
            {tabsLabel && (
              <div className="mt-0.5 pl-5.5 text-ui-tertiary leading-snug tabular-nums text-ink-muted">
                {tabsLabel}
              </div>
            )}
            {hint && (
              <div
                className={cn(
                  "mt-0.5 line-clamp-2 break-words pl-5.5 text-ui-tertiary leading-snug text-ink-muted",
                  view.form === "error" && "select-text",
                )}
              >
                {hint}
              </div>
            )}
            {retrying && (
              // Its own line: run on after the message, the two-line
              // clamp would cut it off.
              <div className="mt-0.5 pl-5.5 text-ui-tertiary leading-snug text-ink-muted">
                {popoverCopy.retrying}
              </div>
            )}
          </div>
          <DropdownMenu.Separator className={STATUS_MENU_SEPARATOR} />
          <DropdownMenu.Item
            onSelect={() => {
              settingsRequestedRef.current = true;
              onOpenSettings?.();
            }}
            className={STATUS_MENU_ITEM}
          >
            <Gear size={14} weight="thin" className="text-ink-soft" />
            <span>{popoverCopy.settings}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
