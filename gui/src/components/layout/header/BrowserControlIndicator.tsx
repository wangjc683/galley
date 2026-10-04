import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Gear, PuzzlePiece } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";

import { TopBarIconButton } from "../TopBarIconButton";
import {
  type BrowserControlIndicatorInput,
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
 *     closed). Click → a status menu (`status-menu.ts`): the state in
 *     one row, a separator, 设置…. The scope line is not repeated here:
 *     a glance surface is reopened every time, and what Galley can see
 *     is read once, in Settings' connected card (2026-10-04, JC: the
 *     panel read long). No 重新检测: the state is live, so a manual
 *     check would only repeat what the bridge already reports.
 *   - Never set up: the 待解锁 badge in the brand tone — an invitation to
 *     Galley's headline capability, not a fault. Click → Settings →
 *     Browser Control directly; that is the only next step.
 *   - Bridge / probe failure: an error badge named by its cause; the
 *     menu adds the bridge's own message as the detail line.
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
            {view.form === "lamp" ? (
              <>
                <div>
                  <span className="font-medium">
                    {view.state === "offline"
                      ? popoverCopy.offline
                      : view.state === "checking"
                        ? popoverCopy.checking
                        : popoverCopy.connected}
                  </span>
                  {(view.state === "connected" || view.state === "noTabs") && (
                    // The tab count rides on the state row as quieter
                    // evidence, not a row of its own.
                    <span className="tabular-nums text-ink-muted">
                      {" · "}
                      {view.state === "connected"
                        ? popoverCopy.tabCount(input.tabCount)
                        : popoverCopy.noTabs}
                    </span>
                  )}
                </div>
                {view.state === "offline" && (
                  <div className="mt-0.5 text-ui-meta text-ink-muted">
                    {popoverCopy.offlineHint}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="font-medium text-error">
                  {errorCopy?.title ?? copy.browserControlErrorTitle}
                </div>
                {input.errorDetail && (
                  <p className="mt-1 select-text break-words text-ui-meta leading-secondary text-ink-soft">
                    {input.errorDetail}
                  </p>
                )}
                {input.errorKind && (
                  // Bridge failures retry on their own (the bridge with
                  // backoff, Core by restarting it); probe failures do not.
                  <p className="mt-1 text-ui-tertiary text-ink-muted">
                    {popoverCopy.retrying}
                  </p>
                )}
              </>
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
