import * as Popover from "@radix-ui/react-popover";
import {
  CheckCircle,
  CircleNotch,
  DownloadSimple,
  Warning,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { downloadPercent } from "@/lib/app-update";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AppUpdateStatus } from "@/stores/app-update";

import {
  TOPBAR_POPOVER_OPEN_STATE,
  topBarStatusBadgeClass,
} from "./topbar-status-badge";
import {
  type TopBarUpdateStatus,
  updateIndicatorVisible,
} from "./update-indicator-status";

/**
 * TopBar app-update indicator (`.scratch/topbar-update-indicator/PRD.md`).
 *
 * Visible only for `available` / `downloading` / `ready` — the three
 * states where "a new version exists" is true and worth ambient
 * awareness. `error` intentionally stays out of the TopBar (toast +
 * Settings own update errors); a persistent red badge for a background
 * nicety would be noise.
 *
 * Two-tier visual weight: available/downloading ride the quiet neutral
 * badge track; only `ready` earns the success tint, because that's the
 * only state with a user action attached.
 *
 * Click → popover with version info and, when ready, the restart
 * button. No one-click restart on the badge itself: restarting tears
 * down the IM supervisor + runner children, so it stays behind an
 * explicit action inside the popover. The store's `restart()` also
 * refuses while sessions run; the disabled button + `readyAfterTasks`
 * note here are the visible face of that same guard.
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
  if (!updateIndicatorVisible(status)) return null;

  const installing =
    status.kind === "downloading" && status.phase === "installing";
  const downloadBarPercent =
    status.kind === "downloading" && !installing
      ? downloadPercent(status.progress)
      : null;
  const badge = updateBadgeView(status, copy.topbar);
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

          {/* Downloading with a known Content-Length gets a determinate
              bar — real byte progress, so the no-fake-progress rule is
              satisfied. `total: null` and the pre-first-event window fall
              through to the spinner; the install phase gets its own copy
              so the bar never freezes at 100%. */}
          {status.kind === "ready" ? (
            <>
              {hasRunningSessions && (
                <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-[1.55] text-warning">
                  <Warning size={13} weight="thin" className="mt-0.5 shrink-0" />
                  <span>{copy.updates.readyAfterTasks}</span>
                </p>
              )}
              <Button
                variant="brand-soft"
                size="md"
                onClick={onRestart}
                disabled={hasRunningSessions}
                className="mt-3 w-full"
              >
                {copy.updates.restart}
              </Button>
            </>
          ) : downloadBarPercent !== null ? (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2 text-[12px] leading-[1.55] text-ink-muted">
                <span>{copy.updates.preparing}</span>
                <span className="tabular-nums">{downloadBarPercent}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={downloadBarPercent}
                aria-label={copy.updates.preparing}
                className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-brand/15"
              >
                <div
                  className="app-update-bar-fill h-full rounded-full bg-brand"
                  style={{ width: `${downloadBarPercent}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-[12px] leading-[1.55] text-ink-muted">
              {status.kind === "available" && hasRunningSessions ? (
                <>
                  <Warning size={13} weight="thin" className="shrink-0" />
                  <span>{copy.updates.foundAfterTasks}</span>
                </>
              ) : (
                <>
                  <CircleNotch size={13} weight="thin" className="spin shrink-0" />
                  <span>
                    {installing
                      ? copy.updates.installing
                      : copy.updates.preparing}
                  </span>
                </>
              )}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function updateBadgeView(
  status: TopBarUpdateStatus,
  copy: ReturnType<typeof useCopy>["topbar"],
): {
  label: string;
  tooltip: string;
  tone: "neutral" | "success";
  Icon: typeof DownloadSimple;
  spin?: boolean;
} {
  if (status.kind === "ready") {
    return {
      label: copy.updateReadyBadge,
      tooltip: copy.updateReadyTooltip,
      tone: "success",
      Icon: CheckCircle,
    };
  }
  if (status.kind === "downloading") {
    return {
      label: copy.updateDownloadingBadge,
      tooltip: copy.updateDownloadingTooltip,
      tone: "neutral",
      Icon: CircleNotch,
      spin: true,
    };
  }
  return {
    label: copy.updateAvailableBadge,
    tooltip: copy.updateAvailableTooltip,
    tone: "neutral",
    Icon: DownloadSimple,
  };
}
