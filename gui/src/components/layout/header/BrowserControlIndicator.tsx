import * as Popover from "@radix-ui/react-popover";
import { PuzzlePiece } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";

import { TopBarIconButton } from "../TopBarIconButton";
import {
  type BrowserControlIndicatorInput,
  browserControlIndicatorView,
} from "./browser-control-indicator-status";
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
 *     closed). Click → popover: the state in one line and 设置…. The
 *     scope line is not repeated here: a glance panel is reopened every
 *     time, and what Galley can see is read once, in Settings' connected
 *     card (2026-10-04, JC: the popover read long). No 重新检测: the
 *     state is live, so a manual check would only repeat what the bridge
 *     already reports.
 *   - Never set up: the 待解锁 badge in the brand tone — an invitation to
 *     Galley's headline capability, not a fault. Click → Settings →
 *     Browser Control directly; that is the only next step.
 *   - Bridge / probe failure: an error badge named by its cause; the
 *     popover adds the bridge's own message as the detail line.
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
  const view = browserControlIndicatorView(input);
  // A popover left open while the indicator turns into a plain badge
  // (an unverified install whose bridge error clears to 待解锁) must not
  // pop back open when the lamp returns.
  const hasPopover = view.form === "lamp" || view.form === "error";
  if (open && !hasPopover) setOpen(false);
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
  const openSettings = () => {
    setOpen(false);
    onOpenSettings?.();
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <TooltipLabel text={tooltip} side="bottom">
        <Popover.Trigger asChild>
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
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="galley-pop-in z-50 w-max min-w-[200px] max-w-[300px] rounded-md border border-line bg-elevated p-4 shadow-elevated outline-none"
        >
          {view.form === "lamp" ? (
            <>
              <div className="text-[13px] font-medium text-ink">
                {view.state === "offline"
                  ? popoverCopy.offline
                  : view.state === "checking"
                    ? popoverCopy.checking
                    : popoverCopy.connected}
                {(view.state === "connected" || view.state === "noTabs") && (
                  // The tab count rides on the state line as quieter
                  // evidence, not a line of its own.
                  <span className="font-normal tabular-nums text-ink-muted">
                    {" · "}
                    {view.state === "connected"
                      ? popoverCopy.tabCount(input.tabCount)
                      : popoverCopy.noTabs}
                  </span>
                )}
              </div>
              {view.state === "offline" && (
                <div className="mt-1 text-[12px] text-ink-muted">
                  {popoverCopy.offlineHint}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-[13px] font-medium text-error">
                {errorCopy?.title ?? copy.browserControlErrorTitle}
              </div>
              {input.errorDetail && (
                <p className="mt-1.5 select-text break-words text-[12px] leading-[1.55] text-ink-soft">
                  {input.errorDetail}
                </p>
              )}
              {input.errorKind && (
                // Bridge failures retry on their own (the bridge with
                // backoff, Core by restarting it); probe failures do not.
                <p className="mt-1.5 text-[11px] text-ink-muted">
                  {popoverCopy.retrying}
                </p>
              )}
            </>
          )}
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" size="sm" onClick={openSettings}>
              {popoverCopy.settings}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
