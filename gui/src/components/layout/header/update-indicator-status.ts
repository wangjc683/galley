import type { AppUpdateStatus } from "@/stores/app-update";

/**
 * Which app-update states earn a TopBar presence
 * (`.scratch/topbar-update-indicator/PRD.md`): available / downloading
 * / ready — the states where "a new version exists". `error` stays out
 * of the TopBar (toast + Settings own update errors).
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
