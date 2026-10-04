import { useCopy } from "@/lib/i18n";
import type { ImSupervisorStatus } from "@/lib/im-supervisor";
import type { AppUpdateStatus } from "@/stores/app-update";
import type { GoalBrief } from "@/types/goal";

import type { BrowserControlIndicatorInput } from "./browser-control-indicator-status";
import { BrowserControlIndicator } from "./BrowserControlIndicator";
import { ChannelsIndicator } from "./ChannelsIndicator";
import { GoalIndicator } from "./GoalIndicator";
import type { RuntimeIndicator } from "./runtime-indicator";
import { RuntimeStatusIndicator } from "./RuntimeStatusIndicator";
import { UpdateIndicator } from "./UpdateIndicator";
import { updateIndicatorVisible } from "./update-indicator-status";

/**
 * Left half of the MainHeader right group: state-of-the-world badges —
 * Goal / engine (内核) / Browser Control / Channels / app Update. Each
 * child decides whether it renders as an icon button (Browser Control
 * and Channels as lamps, see `TopBarLampIcon`) or a text badge; the
 * cluster only owns the ordering and the group ARIA landmark. The
 * parent gates the whole cluster (and the divider after it) on
 * `hasTopBarStatusItems`, so an empty cluster never renders.
 *
 * Ordering: session/workspace-scoped indicators first, the engine ahead
 * of the capabilities that run on it; the app-level Update badge sits
 * last, at the boundary next to the utility cluster — spatially closest
 * to the Settings gear (where update controls also live) without
 * destabilizing the always-on utility buttons.
 */
export function TopBarStatusCluster({
  activeGoals,
  onOpenGoal,
  onStopGoal,
  onExtendGoal,
  runtimeIndicator,
  onOpenRuntimeSettings,
  onOpenModelsSettings,
  browserControl,
  onOpenBrowserControl,
  channelStatuses,
  channelsLoadError,
  onOpenChannelsSettings,
  onRestartChannels,
  appUpdateStatus,
  hasRunningSessions,
  onRestartAppUpdate,
}: {
  activeGoals: GoalBrief[];
  onOpenGoal?: (goalId: string) => void;
  onStopGoal?: (goalId: string) => void;
  onExtendGoal?: (goalId: string) => void;
  runtimeIndicator: RuntimeIndicator;
  onOpenRuntimeSettings?: () => void;
  onOpenModelsSettings?: () => void;
  browserControl: BrowserControlIndicatorInput | null;
  onOpenBrowserControl?: () => void;
  channelStatuses: ReadonlyArray<ImSupervisorStatus | null>;
  channelsLoadError?: string | null;
  onOpenChannelsSettings?: () => void;
  onRestartChannels?: () => void;
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
      {activeGoals.length > 0 && (
        <GoalIndicator
          goals={activeGoals}
          onOpenGoal={onOpenGoal}
          onStopGoal={onStopGoal}
          onExtendGoal={onExtendGoal}
        />
      )}
      {runtimeIndicator !== "hidden" && (
        <RuntimeStatusIndicator
          indicator={runtimeIndicator}
          onOpenRuntime={onOpenRuntimeSettings}
          onOpenModels={onOpenModelsSettings}
        />
      )}
      {browserControl && (
        <BrowserControlIndicator
          input={browserControl}
          onOpenSettings={onOpenBrowserControl}
        />
      )}
      {onOpenChannelsSettings && (
        <ChannelsIndicator
          statuses={channelStatuses}
          loadError={channelsLoadError}
          onOpenSettings={onOpenChannelsSettings}
          onRestart={onRestartChannels}
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
