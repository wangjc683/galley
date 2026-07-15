import { useCopy } from "@/lib/i18n";
import type { BrowserControlStatus } from "@/lib/browser-control";
import type { ImSupervisorState } from "@/lib/im-supervisor";
import type { AppUpdateStatus } from "@/stores/app-update";
import type { GoalBrief } from "@/types/goal";

import { BrowserControlIndicator } from "./BrowserControlIndicator";
import { ChannelsIndicator } from "./ChannelsIndicator";
import { GoalIndicator } from "./GoalIndicator";
import { UpdateIndicator } from "./UpdateIndicator";
import { updateIndicatorVisible } from "./update-indicator-status";
import { YoloIndicator } from "./YoloIndicator";

/**
 * Left half of the MainHeader right group: state-of-the-world badges —
 * YOLO / Goal / Browser Control / Channels / app Update. Each child
 * decides whether it renders as an icon button or a text badge; the
 * cluster only owns the ordering and the group ARIA landmark. The
 * parent gates the whole cluster (and the divider after it) on
 * `hasTopBarStatusItems`, so an empty cluster never renders.
 *
 * Ordering: session/workspace-scoped indicators first; the app-level
 * Update badge sits last, at the boundary next to the utility cluster —
 * spatially closest to the Settings gear (where update controls also
 * live) without destabilizing the always-on utility buttons.
 */
export function TopBarStatusCluster({
  yoloMode,
  onDisableYolo,
  onOpenYoloSettings,
  activeGoals,
  onOpenGoalProject,
  onOpenGoal,
  onStopGoal,
  browserControlStatus,
  onOpenBrowserControl,
  channelsState,
  channelsLoadError,
  onOpenChannelsSettings,
  appUpdateStatus,
  hasRunningSessions,
  onRestartAppUpdate,
}: {
  yoloMode: boolean;
  onDisableYolo?: () => void;
  onOpenYoloSettings?: () => void;
  activeGoals: GoalBrief[];
  onOpenGoalProject?: (projectId: string) => void;
  onOpenGoal?: (goalId: string) => void;
  onStopGoal?: (goalId: string) => void;
  browserControlStatus: BrowserControlStatus | null;
  onOpenBrowserControl?: () => void;
  channelsState: ImSupervisorState | null;
  channelsLoadError?: string | null;
  onOpenChannelsSettings?: () => void;
  appUpdateStatus: AppUpdateStatus;
  hasRunningSessions: boolean;
  onRestartAppUpdate?: () => void;
}) {
  const copy = useCopy().topbar;

  return (
    <div
      role="group"
      aria-label={copy.statusGroupLabel}
      className="flex items-center gap-1"
    >
      {yoloMode && (
        <YoloIndicator
          onDisable={onDisableYolo}
          onOpenSettings={onOpenYoloSettings}
        />
      )}
      {activeGoals.length > 0 && (
        <GoalIndicator
          goals={activeGoals}
          onOpenProject={onOpenGoalProject}
          onOpenGoal={onOpenGoal}
          onStopGoal={onStopGoal}
        />
      )}
      {browserControlStatus && (
        <BrowserControlIndicator
          status={browserControlStatus}
          onOpen={onOpenBrowserControl}
        />
      )}
      {onOpenChannelsSettings && (
        <ChannelsIndicator
          state={channelsState}
          loadError={channelsLoadError}
          onOpen={onOpenChannelsSettings}
        />
      )}
      {updateIndicatorVisible(appUpdateStatus) && (
        <UpdateIndicator
          status={appUpdateStatus}
          hasRunningSessions={hasRunningSessions}
          onRestart={onRestartAppUpdate}
        />
      )}
    </div>
  );
}
