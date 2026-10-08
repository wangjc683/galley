import { downloadPercent } from "@/lib/app-update";
import type { AppUpdateStatus } from "@/stores/app-update";

/**
 * Which app-update states earn a TopBar presence
 * (`.scratch/topbar-update-indicator/PRD.md`): available / downloading
 * / ready — the states where "a new version exists". `error` never
 * shows in the TopBar (2026-07-15): update errors show only in
 * Settings → About, and a failed background download raises no notice;
 * the next launch's check tries again.
 *
 * Lives outside UpdateIndicator.tsx so MainHeader / StatusCluster can
 * import the gate without tripping react-refresh's
 * only-export-components rule on the component file.
 */
export type TopBarUpdateStatus = Extract<
  AppUpdateStatus,
  { kind: "available" | "downloading" | "ready" }
>;

export function updateIndicatorVisible(
  status: AppUpdateStatus,
): status is TopBarUpdateStatus {
  return (
    status.kind === "available" ||
    status.kind === "downloading" ||
    status.kind === "ready"
  );
}

/** The badge's word: 新版本 / · 下载中 / · 安装中 / · 就绪. */
export type TopBarUpdateBadge =
  | "available"
  | "downloading"
  | "installing"
  | "ready";

export function updateBadgeKind(status: TopBarUpdateStatus): TopBarUpdateBadge {
  if (status.kind === "downloading") {
    return status.phase === "installing" ? "installing" : "downloading";
  }
  return status.kind;
}

/**
 * The popover's action area under the version lines.
 *
 * - `download`: the 下载更新 button, whether or not a task runs
 *   (downloading touches no child process).
 * - `progress`: a determinate bar, only with real byte progress (the
 *   no-fake-progress rule).
 * - `spinner`: downloading before the first event or without a
 *   Content-Length, or installing — its own words, so a bar never
 *   freezes at 100%.
 * - `restart`: the 重启并更新 button, held while a task runs
 *   (installing stops the IM supervisor and the runners).
 */
export type TopBarUpdatePopoverBody =
  | { kind: "download" }
  | { kind: "progress"; percent: number }
  | { kind: "spinner"; installing: boolean }
  | { kind: "restart"; waitForTasks: boolean };

export function updatePopoverBody(
  status: TopBarUpdateStatus,
  hasRunningSessions: boolean,
): TopBarUpdatePopoverBody {
  switch (status.kind) {
    case "available":
      return { kind: "download" };
    case "ready":
      return { kind: "restart", waitForTasks: hasRunningSessions };
    case "downloading": {
      if (status.phase === "installing") {
        return { kind: "spinner", installing: true };
      }
      const percent = downloadPercent(status.progress);
      return percent === null
        ? { kind: "spinner", installing: false }
        : { kind: "progress", percent };
    }
  }
}
