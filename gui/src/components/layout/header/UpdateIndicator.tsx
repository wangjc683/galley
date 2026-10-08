import * as Popover from "@radix-ui/react-popover";
import {
  CheckCircle,
  CircleNotch,
  DownloadSimple,
  Warning,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { type AppCopy, useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { type AppUpdateStatus, useAppUpdateStore } from "@/stores/app-update";

import {
  TOPBAR_POPOVER_OPEN_STATE,
  topBarStatusBadgeClass,
} from "./topbar-status-badge";
import {
  type TopBarUpdateBadge,
  updateBadgeKind,
  updateIndicatorVisible,
  updatePopoverBody,
} from "./update-indicator-status";

/**
 * TopBar app-update indicator (`.scratch/topbar-update-indicator/PRD.md`).
 *
 * Visible only for `available` / `downloading` / `ready` — the three
 * states where "a new version exists" is true and worth ambient
 * awareness. `error` never shows here (2026-07-15): update errors show
 * only in Settings → About, and a failed background download raises no
 * notice at all; the next launch's check tries again. A persistent
 * badge for a background nicety would be noise.
 *
 * Two-tier visual weight: available/downloading/installing ride the
 * quiet neutral badge track; only `ready` earns the success tint, the
 * state the update waits on the user for.
 *
 * Click → popover with version info and the one action the state
 * allows: 下载更新 when a new version was found (auto-download off; it
 * never waits for tasks, downloading touches no child process), the
 * restart once downloaded. No one-click restart on the badge itself:
 * installing tears down the IM supervisor + runner children, so it
 * stays behind an explicit action inside the popover. The store's
 * `restart()` also refuses while sessions run; the disabled button +
 * `readyAfterTasks` note here are the visible face of that same guard.
 *
 * The download action comes from the store directly; `onRestart` is
 * passed down from MainHeaderHost.
 */
export function UpdateIndicator({
  status,
  hasRunningSessions,
  onRestart,
}: {
  status: AppUpdateStatus;
  hasRunningSessions: boolean;
  onRestart?: () => void;
}) {
  const copy = useCopy();
  const download = useAppUpdateStore((s) => s.download);
  if (!updateIndicatorVisible(status)) return null;

  const body = updatePopoverBody(status, hasRunningSessions);
  const badge = updateBadgeView(updateBadgeKind(status), copy);
  const version =
    status.kind === "downloading" ? (status.version ?? null) : status.version;
  const currentVersion =
    status.kind === "downloading" ? null : status.currentVersion;
  const title = version
    ? copy.topbar.updateNewVersionTitle(version)
    : copy.topbar.updateDownloadingTitle;
  const BadgeIcon = badge.Icon;

  return (
    <Popover.Root>
      <TooltipLabel text={badge.tooltip} side="bottom">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={badge.tooltip}
            className={topBarStatusBadgeClass(
              badge.tone,
              cn("gap-1.5", TOPBAR_POPOVER_OPEN_STATE),
            )}
          >
            <BadgeIcon
              size={14}
              weight="thin"
              className={cn(badge.spin && "spin")}
            />
            <span>{badge.label}</span>
          </button>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="galley-pop-in z-50 w-[300px] rounded-md border border-line bg-elevated p-4 shadow-elevated outline-none"
        >
          <div className="text-[13px] font-medium text-ink">{title}</div>
          {currentVersion && (
            <div className="mt-1 text-[11px] tabular-nums text-ink-muted">
              {copy.topbar.updateCurrentVersion(currentVersion)}
            </div>
          )}
          {/* No release-notes body in v1: the update channel's `notes`
              field defaults to the bare GitHub Release URL (see
              scripts/generate-tauri-update-manifest.mjs), so rendering
              `status.body` would show a raw link as prose. Re-add once
              the release SOP produces real notes text. */}

          {/* What each body means: update-indicator-status.ts. */}
          {body.kind === "download" ? (
            <Button
              variant="brand-soft"
              size="md"
              onClick={() => void download()}
              className="mt-3 w-full"
            >
              {copy.updates.download}
            </Button>
          ) : body.kind === "restart" ? (
            <>
              {body.waitForTasks && (
                <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-[1.55] text-warning">
                  <Warning size={13} weight="thin" className="mt-0.5 shrink-0" />
                  <span>{copy.updates.readyAfterTasks}</span>
                </p>
              )}
              <Button
                variant="brand-soft"
                size="md"
                onClick={onRestart}
                disabled={body.waitForTasks}
                className="mt-3 w-full"
              >
                {copy.updates.restart}
              </Button>
            </>
          ) : body.kind === "progress" ? (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2 text-[12px] leading-[1.55] text-ink-muted">
                <span>{copy.updates.preparing}</span>
                <span className="tabular-nums">{body.percent}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={body.percent}
                aria-label={copy.updates.preparing}
                className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-brand/15"
              >
                <div
                  className="app-update-bar-fill h-full rounded-full bg-brand"
                  style={{ width: `${body.percent}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-[12px] leading-[1.55] text-ink-muted">
              <CircleNotch size={13} weight="thin" className="spin shrink-0" />
              <span>
                {body.installing
                  ? copy.updates.installing
                  : copy.updates.preparing}
              </span>
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function updateBadgeView(
  badge: TopBarUpdateBadge,
  copy: AppCopy,
): {
  label: string;
  tooltip: string;
  tone: "neutral" | "success";
  Icon: typeof DownloadSimple;
  spin?: boolean;
} {
  switch (badge) {
    case "ready":
      return {
        label: copy.topbar.updateReadyBadge,
        tooltip: copy.topbar.updateReadyTooltip,
        tone: "success",
        Icon: CheckCircle,
      };
    case "installing":
      return {
        label: copy.topbar.updateInstallingBadge,
        tooltip: copy.updates.installing,
        tone: "neutral",
        Icon: CircleNotch,
        spin: true,
      };
    case "downloading":
      return {
        label: copy.topbar.updateDownloadingBadge,
        tooltip: copy.topbar.updateDownloadingTooltip,
        tone: "neutral",
        Icon: CircleNotch,
        spin: true,
      };
    case "available":
      return {
        label: copy.topbar.updateAvailableBadge,
        tooltip: copy.topbar.updateAvailableTooltip,
        tone: "neutral",
        Icon: DownloadSimple,
      };
  }
}
