import { getCurrentWindow } from "@tauri-apps/api/window";

import { useCopy } from "@/lib/i18n";
import { isMac, isWindowActionTarget } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { ConversationFontSize } from "@/lib/conversation-font-size";
import type { ImSupervisorStatus } from "@/lib/im-supervisor";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";
import type { AppUpdateStatus } from "@/stores/app-update";
import type { GoalBrief } from "@/types/goal";

import { WindowControls } from "./WindowControls";
import type { BrowserControlIndicatorInput } from "./header/browser-control-indicator-status";
import type { RuntimeIndicator } from "./header/runtime-indicator";
import { SessionTitleMenu } from "./header/SessionTitleMenu";
import { TopBarStatusCluster } from "./header/StatusCluster";
import { updateIndicatorVisible } from "./header/update-indicator-status";
import { TopBarUtilityCluster } from "./header/UtilityCluster";

export interface MainHeaderProps {
  /**
   * Git review toggle. Omitted (button hidden) while no repository is
   * known and the review is closed — MainHeaderHost decides; the
   * command palette's 查看仓库改动 stays as the always-there entry.
   */
  onToggleChanges?: (source: HTMLElement) => void;
  changesOpen?: boolean;
  /**
   * Current session title to display in the center-left.
   * Empty / undefined = no session active (Empty State); we render an
   * italic muted "新对话" placeholder so the bar always has a title slot.
   */
  sessionTitle?: string;
  onOpenSettings?: () => void;
  /** Browser Control lamp / badge input; null outside the managed runtime. */
  browserControl?: BrowserControlIndicatorInput | null;
  onOpenBrowserControl?: () => void;
  /** Per-platform Channels statuses (fixed order, null = not loaded). */
  channelStatuses?: ReadonlyArray<ImSupervisorStatus | null>;
  channelsLoadError?: string | null;
  onOpenChannelsSettings?: () => void;
  onRestartChannels?: () => void;
  /**
   * Engine (内核) state from `resolveRuntimeIndicator`: nothing when the
   * bundled engine has a model, a "configure" badge when it has none or
   * when the external GA isn't set up, a quiet icon while an external GA
   * is in use. The two handlers open Settings → Runtime / Models.
   */
  runtimeIndicator?: RuntimeIndicator;
  onOpenRuntimeSettings?: () => void;
  onOpenModelsSettings?: () => void;
  /** Supervisor SOP entry in the utility cluster → Settings → Agent. */
  onOpenSupervisorSop?: () => void;
  activeGoals?: GoalBrief[];
  onOpenGoal?: (goalId: string) => void;
  onStopGoal?: (goalId: string) => void;
  onExtendGoal?: (goalId: string) => void;
  /**
   * App-update awareness (`.scratch/topbar-update-indicator/PRD.md`).
   * available / downloading / ready render an UpdateIndicator badge at
   * the tail of the status cluster; every other kind renders nothing.
   * `hasRunningSessions` gates the restart action inside its popover.
   */
  appUpdateStatus?: AppUpdateStatus;
  hasRunningSessions?: boolean;
  onRestartAppUpdate?: () => void;
  /**
   * Conversation column width mode. "compact" = 760px (default),
   * "wide" = 1200px. One of the three rows in the 显示 popover, next
   * to font size and theme.
   */
  conversationWidth?: "compact" | "wide";
  onChangeConversationWidth?: (width: "compact" | "wide") => void;
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
 * The right group is split into two child clusters:
 *   - TopBarStatusCluster — state-of-the-world badges (Goal / engine /
 *     Browser Control / Channels / Update), gated on
 *     `hasTopBarStatusItems`.
 *   - TopBarUtilityCluster — Changes (while a repository is known), the
 *     显示 popover (width / font / theme), Supervisor SOP and Settings.
 * Each cluster and its indicators live under `./header/`.
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
  onToggleChanges,
  changesOpen = false,
  sessionTitle,
  onOpenSettings,
  browserControl = null,
  onOpenBrowserControl,
  channelStatuses = [],
  channelsLoadError = null,
  onOpenChannelsSettings,
  onRestartChannels,
  runtimeIndicator = "hidden",
  onOpenRuntimeSettings,
  onOpenModelsSettings,
  onOpenSupervisorSop,
  activeGoals = [],
  onOpenGoal,
  onStopGoal,
  onExtendGoal,
  appUpdateStatus = { kind: "idle" },
  hasRunningSessions = false,
  onRestartAppUpdate,
  conversationWidth = "compact",
  onChangeConversationWidth,
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
    activeGoals.length > 0 ||
    runtimeIndicator !== "hidden" ||
    browserControl !== null ||
    Boolean(onOpenChannelsSettings) ||
    updateIndicatorVisible(appUpdateStatus);
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
        // bg-app: the main column tone. The Sidebar column + its header
        // are bg-chrome; the two read as a two-tone workbench split by
        // the full-height resize separator, not one uniform top bar.
        // Which tone is lighter flips with the theme (chrome is darker
        // than the light canvas, lighter than the dark one — see
        // --color-chrome in globals.css), so do not hardcode either as
        // "the darker column". Bottom border matches SidebarHeader so
        // the two column headers line up into one continuous top strip.
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
            activeGoals={activeGoals}
            onOpenGoal={onOpenGoal}
            onStopGoal={onStopGoal}
            onExtendGoal={onExtendGoal}
            runtimeIndicator={runtimeIndicator}
            onOpenRuntimeSettings={onOpenRuntimeSettings}
            onOpenModelsSettings={onOpenModelsSettings}
            browserControl={browserControl}
            onOpenBrowserControl={onOpenBrowserControl}
            channelStatuses={channelStatuses}
            channelsLoadError={channelsLoadError}
            onOpenChannelsSettings={onOpenChannelsSettings}
            onRestartChannels={onRestartChannels}
            appUpdateStatus={appUpdateStatus}
            hasRunningSessions={hasRunningSessions}
            onRestartAppUpdate={onRestartAppUpdate}
          />
        )}
        {hasTopBarStatusItems && (
          <div aria-hidden="true" className="h-5 w-px bg-line/80" />
        )}
        <TopBarUtilityCluster
          changesOpen={changesOpen}
          onToggleChanges={onToggleChanges}
          conversationWidth={conversationWidth}
          onChangeConversationWidth={onChangeConversationWidth}
          conversationFontSize={conversationFontSize}
          onChangeConversationFontSize={onChangeConversationFontSize}
          themePreference={themePreference}
          resolvedTheme={resolvedTheme}
          onChangeThemePreference={onChangeThemePreference}
          onOpenSupervisorSop={onOpenSupervisorSop}
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
