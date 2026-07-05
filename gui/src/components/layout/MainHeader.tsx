import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowRight,
  ArrowsClockwise,
  ArrowsInLineHorizontal,
  ArrowsOutLineHorizontal,
  CaretDown,
  Cat,
  ChatCircleText,
  CheckCircle,
  FolderOpen,
  Gear,
  Lightning,
  PencilSimple,
  PuzzlePiece,
  Target,
  TextAa,
  Warning,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ThemePreferenceMenu } from "@/components/theme/ThemePreferenceMenu";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  goalPillLabel,
  goalStageLabel,
  goalWorkspaceHasFiles,
} from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { isImeCompositionKeydown } from "@/lib/ime";
import { isMac, isWindowActionTarget } from "@/lib/platform";
import { formatShortcutReadable } from "@/lib/shortcuts";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { BrowserControlStatus } from "@/lib/browser-control";
import type { ConversationFontSize } from "@/lib/conversation-font-size";
import type { ImSupervisorState } from "@/lib/im-supervisor";
import type { GoalBrief } from "@/types/goal";

import { TopBarIconButton } from "./TopBarIconButton";
import { WindowControls } from "./WindowControls";

export interface MainHeaderProps {
  /**
   * Current session title to display in the center-left.
   * Empty / undefined = no session active (Empty State); we render an
   * italic muted "新对话" placeholder so the bar always has a title slot.
   */
  sessionTitle?: string;
  /**
   * YOLO mode (PRD §11.5). When true, render a persistent badge in
   * the right cluster — clicking it opens a popover with a one-click
   * disable. Required for V0.1 release; without it users forget the
   * mode is on and trigger high-risk operations unintentionally
   * (DESIGN.md §4.1 YOLO Indicator).
   */
  yoloMode?: boolean;
  onDisableYolo?: () => void;
  onOpenSettings?: () => void;
  /** YOLO popover link: opens Settings directly on the Approval tab. */
  onOpenApprovalSettings?: () => void;
  browserControlStatus?: BrowserControlStatus | null;
  onOpenBrowserControl?: () => void;
  channelsState?: ImSupervisorState | null;
  channelsLoadError?: string | null;
  onOpenChannelsSettings?: () => void;
  activeGoals?: GoalBrief[];
  onOpenGoalProject?: (projectId: string) => void;
  onOpenGoal?: (goalId: string) => void;
  onStopGoal?: (goalId: string) => void;
  /**
   * Conversation column width mode. "compact" = 760px (default),
   * "wide" = 1200px. Renders an icon button next to the font-size
   * control that flips between the two modes.
   */
  conversationWidth?: "compact" | "wide";
  onToggleConversationWidth?: () => void;
  conversationFontSize?: ConversationFontSize;
  onChangeConversationFontSize?: (size: ConversationFontSize) => void;
  themePreference?: ThemePreference;
  resolvedTheme?: ResolvedTheme;
  onChangeThemePreference?: (preference: ThemePreference) => void;
  /**
   * Session-level overflow menu items (`⋯` button). The menu holds
   * actions that operate on the current session and don't deserve a
   * dedicated TopBar slot:
   *
   *   - Reinject Tools: re-injects GA's tool definitions into the
   *     active session's LLM history. Low-frequency power-user fix
   *     for "agent forgot its tools" after long runs.
   *   - Desktop Pet: launches GA's `desktop_pet_v2.pyw` subprocess
   *     and attaches a turn_end hook to a session. Clicking from a
   *     non-holder session implicitly migrates the pet here (the
   *     parent's onTogglePet handles the detach/attach sequence).
   *
   * `currentSessionHasPet` = pet is attached to the session whose
   * title this menu represents. Drives the 2-state label:
   *   true  → "关闭桌面宠物"
   *   false → "桌面宠物"
   * Whether a pet exists ON ANOTHER session is conveyed by the
   * Sidebar's Cat badge; the menu intentionally doesn't surface
   * that distinction.
   */
  onReinjectTools?: () => void;
  onTogglePet?: () => void;
  currentSessionHasPet?: boolean;
  /**
   * Rename the active session. When provided, the title menu shows a
   * "重命名" entry that flips the title block into an inline input —
   * mirrors the right-click rename in Sidebar so users have two
   * equally-discoverable rename paths.
   */
  onRenameSession?: (newTitle: string) => void;
}

type TopBarStatusTone = "brand" | "error" | "neutral" | "success" | "warning";

const TOPBAR_CONTROL_MOTION = cn(
  "transition-[background-color,border-color,color,transform]",
  "duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]",
  "active:translate-y-[0.5px] active:duration-[45ms]",
);

const TOPBAR_POPOVER_OPEN_STATE =
  "data-[state=open]:translate-y-px data-[state=open]:shadow-[var(--shadow-control-press)]";

const TOPBAR_STATUS_BADGE_BASE = cn(
  "inline-flex h-7 items-center whitespace-nowrap rounded-md border px-2.5 text-[12px] font-medium",
  "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
  TOPBAR_CONTROL_MOTION,
);

const TOPBAR_STATUS_BADGE_TONE: Record<TopBarStatusTone, string> = {
  brand:
    "border-brand/30 bg-brand-soft text-brand-strong hover:bg-brand-soft/80",
  error:
    "border-error/30 bg-error/[var(--opacity-soft)] text-error hover:bg-error/[var(--opacity-medium)]",
  neutral:
    "border-line bg-elevated text-ink-muted hover:bg-hover hover:text-ink",
  success:
    "border-success/30 bg-success/[var(--opacity-soft)] text-success hover:bg-success/[var(--opacity-medium)]",
  warning:
    "border-warning/30 bg-warning/[var(--opacity-soft)] text-warning hover:bg-warning/[var(--opacity-medium)]",
};

function topBarStatusBadgeClass(tone: TopBarStatusTone, className?: string) {
  return cn(
    TOPBAR_STATUS_BADGE_BASE,
    TOPBAR_STATUS_BADGE_TONE[tone],
    className,
  );
}

/**
 * Main header — the header bar of the *main column* (not a full-window
 * top bar). 44px tall. Per DESIGN.md §4.1.
 *
 *   [ title ▾  ········ drag ········  status │ utility │ (win ctrls) ]
 *
 * Sits at the top of the main panel (above the conversation / empty
 * state), as a sibling of the resizable Sidebar column — which grows
 * its own header (SidebarHeader). The two column headers are the same
 * height so their bottom borders align into one continuous top strip,
 * split by the full-height resize separator between the columns.
 *
 * Layout — title left-aligned against the column's left gutter, the
 * action cluster pinned right, and draggable empty space between them.
 *
 * Why title-left (not centered): Galley is a multi-session workspace
 * (Linear / Slack / Arc class), not a single-document app (Safari /
 * Pages / Finder) where a centered document title is the idiom. The
 * session title belongs to *this conversation*, so it lives above the
 * conversation column where the eye lands first — together with its
 * rename / session-menu affordance.
 *
 * No traffic-light reserve here: on macOS the traffic lights sit at the
 * window's top-LEFT, which is the *Sidebar* column — SidebarHeader owns
 * that clearance. This header only reserves the right edge for the
 * Windows custom WindowControls (min / max / close); macOS hands window
 * control to the overlay traffic light on the sidebar side.
 *
 * Window dragging:
 *   - Tauri v2 only honours `data-tauri-drag-region` when the
 *     `core:window:allow-start-dragging` permission is granted —
 *     `core:default` does NOT include it. We add it explicitly in
 *     capabilities/default.json.
 *   - The attribute is non-bubbling (the element receiving mousedown
 *     must carry it). We mark the root, the title slot, and the title
 *     span / placeholder. Buttons are auto-excluded by Tauri.
 *   - SidebarHeader carries the same drag region, so both column
 *     headers act as one window-drag handle.
 *
 * The inline-rename <input> opts out of the drag region via
 * data-tauri-drag-region="false" (otherwise mousedown gets captured by
 * the OS for window drag instead of focusing the input).
 */
export function MainHeader({
  sessionTitle,
  yoloMode = false,
  onDisableYolo,
  onOpenSettings,
  onOpenApprovalSettings,
  browserControlStatus = null,
  onOpenBrowserControl,
  channelsState = null,
  channelsLoadError = null,
  onOpenChannelsSettings,
  activeGoals = [],
  onOpenGoalProject,
  onOpenGoal,
  onStopGoal,
  conversationWidth = "compact",
  onToggleConversationWidth,
  conversationFontSize = "standard",
  onChangeConversationFontSize,
  themePreference = "system",
  resolvedTheme = "light",
  onChangeThemePreference,
  onReinjectTools,
  onTogglePet,
  currentSessionHasPet = false,
  onRenameSession,
}: MainHeaderProps) {
  const copy = useCopy();
  const hasTopBarStatusItems =
    yoloMode ||
    activeGoals.length > 0 ||
    browserControlStatus !== null ||
    Boolean(onOpenChannelsSettings);
  return (
    <div
      data-tauri-drag-region
      // Windows custom chrome: double-click anywhere draggable on the
      // main header toggles maximize, mirroring native title-bar
      // behavior. Mac's Overlay style hands this to the OS, so we
      // early-exit.
      onDoubleClick={(e) => {
        if (isMac) return;
        if (!isWindowActionTarget(e.target)) return;
        try {
          void getCurrentWindow().toggleMaximize();
        } catch {
          // No Tauri host (e.g. plain Vite browser dev) — ignore.
        }
      }}
      className={cn(
        // bg-app: the main column tone (lighter). The Sidebar column +
        // its header are bg-chrome (darker); the two read as a two-tone
        // workbench split by the full-height resize separator, not one
        // uniform top bar. Bottom border matches SidebarHeader so the
        // two column headers line up into one continuous top strip.
        "flex h-11 shrink-0 items-stretch border-b border-line/60 bg-app text-[13px]",
        // Windows: no right padding — WindowControls owns the right edge
        // and hugs the window corner (= window top-right). Mac keeps its
        // 12px breathing room since the right cluster ends the header.
        isMac && "pr-3",
      )}
    >
      {/* Title-as-dropdown trigger. The title text + caret
          form a single button that opens session-scoped actions
          (Reinject Tools / Desktop Pet, plus Rename when V0.1 #3
          lands). Notion / Linear / Arc convention — clicking the
          document name opens its menu.

          History: previously a bare title `<span>` with a separate
          `⋯` button next to it. Visually the trailing dots read as
          CSS text-overflow ellipsis, not as an affordance — users
          didn't realize it was a menu. Folding the menu into the
          title makes "this is interactive" unambiguous (caret +
          hover fill) and gives a future home for inline rename.

          Empty state ("新对话" placeholder): non-interactive, draggable
          span. Same "affordance only when usable" rule applied
          elsewhere (ApprovalDock / Composer Stop / AskUserBubble).

          Drag region: the wrapping div is draggable so the empty space
          to the right of the left-aligned title still drags the window.
          The button itself is auto-excluded by Tauri (buttons don't
          trigger drag), so clicks open the menu instead of dragging. */}
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center justify-start pl-4 pr-3"
      >
        {sessionTitle ? (
          <SessionTitleMenu
            title={sessionTitle}
            onReinjectTools={onReinjectTools}
            onTogglePet={onTogglePet}
            currentSessionHasPet={currentSessionHasPet}
            onRename={onRenameSession}
          />
        ) : (
          <span
            data-tauri-drag-region
            className="truncate text-[13px] italic text-ink-muted"
          >
            {copy.topbar.newConversation}
          </span>
        )}
      </div>

      {/* Right: status cluster + utility cluster. Global controls only —
          session-level actions live next to the title (see comment above).
          Buttons are auto-excluded from drag region by Tauri so they remain
          clickable. */}
      <div className="flex shrink-0 items-center gap-2">
        {hasTopBarStatusItems && (
          <TopBarStatusCluster
            yoloMode={yoloMode}
            onDisableYolo={onDisableYolo}
            onOpenYoloSettings={onOpenApprovalSettings ?? onOpenSettings}
            activeGoals={activeGoals}
            onOpenGoalProject={onOpenGoalProject}
            onOpenGoal={onOpenGoal}
            onStopGoal={onStopGoal}
            browserControlStatus={browserControlStatus}
            onOpenBrowserControl={onOpenBrowserControl}
            channelsState={channelsState}
            channelsLoadError={channelsLoadError}
            onOpenChannelsSettings={onOpenChannelsSettings}
          />
        )}
        {hasTopBarStatusItems && (
          <div aria-hidden="true" className="h-5 w-px bg-line/80" />
        )}
        <TopBarUtilityCluster
          conversationWidth={conversationWidth}
          onToggleConversationWidth={onToggleConversationWidth}
          conversationFontSize={conversationFontSize}
          onChangeConversationFontSize={onChangeConversationFontSize}
          themePreference={themePreference}
          resolvedTheme={resolvedTheme}
          onChangeThemePreference={onChangeThemePreference}
          onOpenSettings={onOpenSettings}
        />
        {/* Windows-only custom chrome: min / max-restore / close. Hugs
            the window's right edge (TopBar drops pr-3 on Win for this).
            Mac path renders nothing — the traffic light on the left
            already owns the window-control role. */}
        {!isMac && <WindowControls />}
      </div>
    </div>
  );
}

function TopBarStatusCluster({
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
    </div>
  );
}

function TopBarUtilityCluster({
  conversationWidth,
  onToggleConversationWidth,
  conversationFontSize,
  onChangeConversationFontSize,
  themePreference,
  resolvedTheme,
  onChangeThemePreference,
  onOpenSettings,
}: {
  conversationWidth: "compact" | "wide";
  onToggleConversationWidth?: () => void;
  conversationFontSize: ConversationFontSize;
  onChangeConversationFontSize?: (size: ConversationFontSize) => void;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onChangeThemePreference?: (preference: ThemePreference) => void;
  onOpenSettings?: () => void;
}) {
  const copy = useCopy().topbar;

  return (
    <div
      role="group"
      aria-label={copy.utilityGroupLabel}
      className="flex items-center gap-1"
    >
      {/* No Search button here — the Sidebar's Quick Actions has
          its own search affordance, and ⌘K opens the palette from
          anywhere. Two click affordances for the same thing was
          chrome clutter without payoff. */}
      <WidthToggleButton
        mode={conversationWidth}
        onToggle={onToggleConversationWidth}
      />
      <ConversationFontSizeMenu
        value={conversationFontSize}
        onChange={onChangeConversationFontSize}
      />
      {onChangeThemePreference && (
        <ThemePreferenceMenu
          preference={themePreference}
          resolvedTheme={resolvedTheme}
          onChange={onChangeThemePreference}
          variant="topbar"
        />
      )}
      <TooltipLabel text={copy.settingsShortcut(formatShortcutReadable("Mod+,"))}>
        <TopBarIconButton onClick={onOpenSettings} aria-label={copy.openSettings}>
          <Gear size={16} weight="thin" />
        </TopBarIconButton>
      </TooltipLabel>
    </div>
  );
}

function GoalIndicator({
  goals,
  onOpenProject,
  onOpenGoal,
  onStopGoal,
}: {
  goals: GoalBrief[];
  onOpenProject?: (projectId: string) => void;
  onOpenGoal?: (goalId: string) => void;
  onStopGoal?: (goalId: string) => void;
}) {
  const copy = useCopy().topbar;
  const [confirmingStopId, setConfirmingStopId] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState<Record<string, boolean>>(
    {},
  );
  const primary = goals[0];
  const visualGoal = goalAttentionGoal(goals);
  const label =
    goals.length > 1
      ? copy.goalPillMultiple(goals.length)
      : goalPillLabel(primary.status, copy);
  const style = goalIndicatorStyle(visualGoal);
  const Icon =
    visualGoal.status === "completed"
      ? CheckCircle
      : visualGoal.status === "failed"
        ? Warning
        : Target;
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) {
          setConfirmingStopId(null);
          return;
        }
        // On open, gate the "open output folder" affordance: only goals
        // whose scratch workspace actually holds files get the button.
        // Checked here (rare) rather than on the 5s poll.
        for (const goal of goals) {
          if (!goal.workspacePath) continue;
          void goalWorkspaceHasFiles(goal.id)
            .then((hasFiles) => {
              setWorkspaceReady((prev) =>
                prev[goal.id] === hasFiles
                  ? prev
                  : { ...prev, [goal.id]: hasFiles },
              );
            })
            .catch(() => undefined);
        }
      }}
    >
      <TooltipLabel text={copy.goalTooltip} side="bottom">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={copy.goalTooltip}
            className={topBarStatusBadgeClass(
              style.tone,
              cn("gap-1.5", TOPBAR_POPOVER_OPEN_STATE),
            )}
          >
            <Icon size={14} weight="thin" />
            <span>{label}</span>
          </button>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="galley-pop-in z-50 max-h-[min(70vh,520px)] w-[320px] overflow-y-auto rounded-md border border-line bg-elevated p-3 shadow-elevated"
        >
          <div className="space-y-3">
            {goals.map((goal) => {
              const remaining =
                goal.status === "running" || goal.status === "wrapping"
                  ? remainingMinutes(goal.deadlineAt)
                  : null;
              return (
                <div
                  key={goal.id}
                  className="border-b border-line/70 pb-3 last:border-0 last:pb-0"
                >
                  {/* Status line: stage dot + word (left), live
                      countdown (right). The countdown lives here, not
                      on the pill, because it ticks to zero at the
                      deadline while the Goal is still wrapping up. */}
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        goalStageDotClass(goal),
                      )}
                    />
                    <span
                      className={cn(
                        "text-[12px] font-medium",
                        goalStageTextClass(goal),
                      )}
                    >
                      {goalStageLabel(goal.status, copy)}
                    </span>
                    {remaining !== null && (
                      <span className="ml-auto text-[12px] tabular-nums text-ink-soft">
                        {copy.goalRemaining(remaining)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 line-clamp-2 break-words text-[13px] font-medium leading-snug text-ink">
                    {goal.objective}
                  </div>
                  <div className="mt-1 text-[11px] text-ink-muted">
                    {copy.goalWorkerCount(goal.workerLimit)}
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    <Button
                      size="sm"
                      variant="brand-soft"
                      className="w-full justify-center"
                      onClick={() => onOpenGoal?.(goal.id)}
                    >
                      {goalPrimaryActionLabel(goal, copy)}
                    </Button>
                    {(goal.status === "running" ||
                      goal.status === "wrapping") &&
                      confirmingStopId === goal.id && (
                        <div className="text-[11px] leading-snug text-error">
                          {copy.stopGoalConsequence}
                        </div>
                      )}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <div className="flex min-w-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[12px]"
                          onClick={() => onOpenProject?.(goal.projectId)}
                        >
                          {copy.openGoalProject}
                        </Button>
                        {workspaceReady[goal.id] && goal.workspacePath && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[12px]"
                            leadingIcon={<FolderOpen size={13} weight="thin" />}
                            onClick={() => {
                              const path = goal.workspacePath;
                              if (path) {
                                void revealItemInDir(path).catch(
                                  () => undefined,
                                );
                              }
                            }}
                          >
                            {copy.openGoalWorkspace}
                          </Button>
                        )}
                      </div>
                      {(goal.status === "running" ||
                        goal.status === "wrapping") &&
                        (confirmingStopId === goal.id ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 border border-error bg-error/[var(--opacity-soft)] px-2.5 font-medium text-error hover:bg-error/[var(--opacity-medium)] hover:text-error"
                            onClick={() => {
                              setConfirmingStopId(null);
                              onStopGoal?.(goal.id);
                            }}
                          >
                            {copy.confirmStopGoal}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 border border-error/25 px-2.5 font-medium text-error hover:bg-error/[var(--opacity-soft)] hover:text-error"
                            onClick={() => setConfirmingStopId(goal.id)}
                          >
                            {copy.stopGoal}
                          </Button>
                        ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function goalPrimaryActionLabel(
  goal: GoalBrief,
  copy: ReturnType<typeof useCopy>["topbar"],
) {
  if (goal.status === "completed") return copy.openGoalResult;
  if (goal.status === "failed") return copy.viewGoalDetails;
  return copy.openGoal;
}

function goalAttentionGoal(goals: GoalBrief[]): GoalBrief {
  // Pill color/icon should reflect the most attention-worthy status,
  // not the backend list order (which puts running first). A failed
  // Goal waiting for the user must not hide behind a calm brand-color
  // pill just because another Goal is still running.
  const priority: Record<GoalBrief["status"], number> = {
    failed: 0,
    completed: 1,
    wrapping: 2,
    running: 3,
    stopped: 4,
  };
  return goals.reduce((best, goal) =>
    priority[goal.status] < priority[best.status] ? goal : best,
  );
}

function goalIndicatorStyle(goal: GoalBrief): { tone: TopBarStatusTone } {
  if (goal.status === "failed") {
    return {
      tone: "error",
    };
  }
  if (goal.status === "completed") {
    return {
      tone: "success",
    };
  }
  return {
    tone: "brand",
  };
}

function goalStageDotClass(goal: GoalBrief) {
  if (goal.status === "failed") return "bg-error";
  if (goal.status === "completed") return "bg-success";
  if (goal.status === "stopped") return "bg-ink-muted";
  return "bg-brand-strong";
}

function goalStageTextClass(goal: GoalBrief) {
  if (goal.status === "failed") return "text-error";
  if (goal.status === "completed") return "text-success";
  if (goal.status === "stopped") return "text-ink-muted";
  return "text-brand-strong";
}

function remainingMinutes(deadlineAt: string) {
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 60_000));
}

function ChannelsIndicator({
  state,
  loadError,
  onOpen,
}: {
  state: ImSupervisorState | null;
  loadError?: string | null;
  onOpen?: () => void;
}) {
  const copy = useCopy().topbar;
  const status = channelsTopbarStatus(state, loadError);
  const title = {
    setup: copy.channelsSetup,
    connecting: copy.channelsConnecting,
    waitingScan: copy.channelsWaitingScan,
    connected: copy.channelsConnected,
    needsAttention: copy.channelsNeedsAttention,
  }[status];

  if (status === "setup" || status === "connected") {
    return (
      <TooltipLabel text={title}>
        <TopBarIconButton onClick={onOpen} aria-label={title}>
          <ChatCircleText size={16} weight="thin" />
        </TopBarIconButton>
      </TooltipLabel>
    );
  }

  const badgeLabel = {
    connecting: copy.channelsConnectingBadge,
    waitingScan: copy.channelsWaitingScanBadge,
    needsAttention: copy.channelsNeedsAttentionBadge,
  }[status];

  return (
    <TooltipLabel text={title}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={title}
        className={topBarStatusBadgeClass(
          status === "needsAttention"
            ? "error"
            : status === "connecting"
              ? "neutral"
              : "warning",
        )}
      >
        {badgeLabel}
      </button>
    </TooltipLabel>
  );
}

function channelsTopbarStatus(
  state: ImSupervisorState | null,
  loadError?: string | null,
) {
  if (loadError || state === "expired" || state === "error") {
    return "needsAttention";
  }
  if (state === "running") return "connected";
  if (state === "starting" || state === "reconnecting") return "connecting";
  if (state === "waiting_scan") return "waitingScan";
  return "setup";
}

function BrowserControlIndicator({
  status,
  onOpen,
}: {
  status: BrowserControlStatus;
  onOpen?: () => void;
}) {
  const copy = useCopy().topbar;
  const connected = status === "connected";
  const connectedNoTabs = status === "connected_no_tabs";
  const offline = status === "offline";
  const bridgeReady = connected || connectedNoTabs;
  const checking = status === "unknown";
  const error = status === "error";
  const label = checking
    ? copy.browserControlChecking
    : error
      ? copy.browserControlError
      : copy.browserControlPending;
  const title = connected
    ? copy.browserControlConnectedTitle
    : connectedNoTabs
      ? copy.browserControlNoTabsTitle
      : offline
        ? copy.browserControlOfflineTitle
        : error
          ? copy.browserControlErrorTitle
          : copy.browserControlPendingTitle;
  if (bridgeReady || offline) {
    return (
      <TooltipLabel text={title}>
        <TopBarIconButton onClick={onOpen} aria-label={title}>
          <PuzzlePiece size={16} weight="thin" />
        </TopBarIconButton>
      </TooltipLabel>
    );
  }

  return (
    <TooltipLabel text={title}>
      <button
        type="button"
        onClick={onOpen}
        className={topBarStatusBadgeClass(
          error ? "error" : checking ? "neutral" : "warning",
        )}
        aria-label={title}
      >
        {label}
      </button>
    </TooltipLabel>
  );
}

/**
 * Persistent YOLO indicator (DESIGN.md §4.1 / PRD §11.5).
 *
 * Visible only while yoloMode is true. Click → Radix Popover with:
 *   - Status line ("YOLO 模式已开启")
 *   - "立即关闭" warning-tinted button (calls onDisable)
 *   - Secondary link to Settings → Approval tab
 *
 * Visual: warning-tinted text badge using the shared TopBar status
 * style. Hover/open use the shared TopBar control rhythm, but there is
 * no looping animation — users tune out blinking; static colour reads
 * "this is a state, be aware" without becoming background noise.
 */
function YoloIndicator({
  onDisable,
  onOpenSettings,
}: {
  onDisable?: () => void;
  onOpenSettings?: () => void;
}) {
  const copy = useCopy();
  return (
    <Popover.Root>
      <TooltipLabel text={copy.topbar.yoloTooltip} side="bottom">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={copy.topbar.yoloView}
            className={topBarStatusBadgeClass(
              "warning",
              cn(
                "uppercase tracking-[0.04em] hover:-translate-y-px hover:border-warning hover:bg-warning hover:text-elevated hover:shadow-[var(--shadow-button-raised-hover)]",
                TOPBAR_POPOVER_OPEN_STATE,
                "data-[state=open]:border-warning data-[state=open]:bg-warning data-[state=open]:text-elevated",
              ),
            )}
          >
            YOLO
          </button>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className={cn(
            "galley-pop-in z-50 w-[280px] overflow-hidden rounded-md border border-warning/30 bg-elevated shadow-elevated",
          )}
        >
          {/* Caution header band mirrors the shared warning badge while
              using Lightning inside the expanded risk surface. The
              collapsed TopBar badge stays text-only. */}
          <div className="flex items-center gap-2 border-b border-warning/20 bg-warning/[var(--opacity-subtle)] px-4 py-3">
            <Lightning size={16} weight="thin" className="text-warning" />
            <div className="text-[13px] font-medium text-ink">
              {copy.topbar.yoloOn}
            </div>
          </div>
          <div className="p-4">
            <p className="text-[12px] leading-[1.55] text-ink-muted">
              {copy.topbar.yoloDetail}
            </p>
            <Button
              variant="warning"
              size="md"
              onClick={onDisable}
              className="mt-3 w-full"
            >
              {copy.topbar.turnOffNow}
            </Button>
            {onOpenSettings && (
              <Popover.Close asChild>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={onOpenSettings}
                  className="mt-2 w-full"
                  trailingIcon={<ArrowRight size={12} weight="thin" />}
                >
                  {copy.topbar.viewInSettings}
                </Button>
              </Popover.Close>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

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
function SessionTitleMenu({
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
            "group inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1",
            "transition-[background-color,color,transform] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-hover data-[state=open]:bg-hover active:translate-y-[0.5px] active:duration-[45ms]",
            "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          <span className="truncate font-medium text-ink">{title}</span>
          <CaretDown
            size={11}
            weight="bold"
            className={cn(
              "shrink-0 text-ink-muted transition-transform",
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
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none",
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
              "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none",
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
              "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none",
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

/**
 * Inline title editor — appears when the user picks "重命名" from the
 * title menu. Mirrors the Sidebar inline-edit pattern:
 *
 *   - autofocus + select-all on mount
 *   - Enter commits, Escape cancels, blur commits ("click outside
 *     doesn't lose work" — matches Sidebar)
 *   - settledRef guards against the Enter-then-blur double-fire
 *
 * Tauri-specific: the wrapping TopBar div is `data-tauri-drag-region`,
 * which captures mousedown for window dragging. Per-element opt-out
 * via `data-tauri-drag-region="false"` lets the input receive
 * mousedown / focus normally — without this, clicking the input drags
 * the window instead of moving the cursor.
 */
function SessionTitleEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (newTitle: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const settledRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(value);
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      data-tauri-drag-region="false"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (isImeCompositionKeydown(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
      className={cn(
        "w-full max-w-[480px] min-w-0 rounded-md bg-app px-2 py-1 text-[13px] font-medium text-ink",
        "border border-line outline-none ring-2 ring-brand/30 focus:border-brand",
      )}
    />
  );
}

/**
 * Conversation font-size control.
 *
 * Trigger: fixed-size TextAa icon button; current tier lives in the
 * tooltip and the popover, never on the button face. (Earlier designs
 * scaled a custom "A" glyph with the tier — a ~2px difference is
 * unreadable as state and made the icon jump on change — then tried a
 * persistent brand tint for non-default tiers, which turned a settled
 * preference into standing chrome noise.)
 *
 * Panel: a Popover (not DropdownMenu) on purpose — it stays open after
 * a pick so the user can flip through tiers and watch the conversation
 * re-render live, then dismiss. Content is the shared SegmentedControl,
 * matching how three-way choices look everywhere else in the app.
 */
function ConversationFontSizeMenu({
  value,
  onChange,
}: {
  value: ConversationFontSize;
  onChange?: (size: ConversationFontSize) => void;
}) {
  const copy = useCopy().topbar.conversationFontSize;
  const selectedLabel = fontSizeLabel(copy, value);

  return (
    <Popover.Root>
      <TooltipLabel text={selectedLabel}>
        <Popover.Trigger asChild>
          <TopBarIconButton aria-label={selectedLabel}>
            <TextAa size={16} weight="thin" />
          </TopBarIconButton>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={6}
          className="galley-pop-in z-[70] rounded-md border border-line bg-elevated p-1.5 shadow-elevated"
        >
          <SegmentedControl
            value={value}
            ariaLabel={copy.aria}
            onValueChange={(size) => onChange?.(size)}
            options={[
              // No per-segment tooltips: the labels are self-evident, and
              // Popover's open autofocus lands on the first segment, which
              // would pop its tooltip ("小字号") regardless of the actual
              // selection.
              { value: "small", label: copy.smallShort },
              { value: "standard", label: copy.standardShort },
              { value: "large", label: copy.largeShort },
            ]}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function fontSizeLabel(
  copy: ReturnType<typeof useCopy>["topbar"]["conversationFontSize"],
  value: ConversationFontSize,
): string {
  if (value === "small") return copy.small;
  if (value === "large") return copy.large;
  return copy.standard;
}

/**
 * Conversation width toggle.
 *
 * Icon direction expresses the action (expand while compact, collapse
 * while wide) — that flip is the only state on the button face; the
 * wide mode gets no persistent tint. Tooltip and aria-label carry the
 * text so this stays a light topbar tool instead of a status pill.
 */
function WidthToggleButton({
  mode,
  onToggle,
}: {
  mode: "compact" | "wide";
  onToggle?: () => void;
}) {
  const copy = useCopy();
  const isWide = mode === "wide";
  const tooltip = isWide
    ? copy.topbar.compactWidthTitle
    : copy.topbar.wideWidthTitle;
  return (
    <TooltipLabel text={tooltip}>
      <TopBarIconButton
        onClick={onToggle}
        aria-label={isWide ? copy.topbar.compactWidth : copy.topbar.wideWidth}
      >
        {/* 14px, not the cluster's usual 16px: the wide horizontal
            arrows read optically larger than the compact TextAa /
            sun / gear glyphs; the smaller box makes the four utility
            buttons weigh the same to the eye. */}
        {isWide ? (
          <ArrowsInLineHorizontal size={14} weight="thin" />
        ) : (
          <ArrowsOutLineHorizontal size={14} weight="thin" />
        )}
      </TopBarIconButton>
    </TooltipLabel>
  );
}
