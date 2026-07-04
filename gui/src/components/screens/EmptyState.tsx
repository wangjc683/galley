import { FolderOpen } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import {
  Composer,
  type ComposerHandle,
  type ComposerLLMOption,
  type ImageBlockReason,
} from "@/components/conversation/Composer";
import { Epigraph } from "@/components/screens/Epigraph";
import {
  conversationTypographyStyle,
  type ConversationFontSize,
} from "@/lib/conversation-font-size";
import type { EpigraphCondition } from "@/lib/epigraphs";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PendingImageAttachment } from "@/types/conversation";
import type { GoalLaunchConfig } from "@/types/goal";

export interface EmptyStateProps {
  llmDisplayName: string;
  onSubmit?: (
    text: string,
    attachments: PendingImageAttachment[],
  ) => boolean | void;
  onGoalSubmit?: (
    text: string,
    config: GoalLaunchConfig,
  ) => void | Promise<void>;
  /** True when a Goal is active anywhere — gates the Goal entry under the
   * single-active-Goal rule. */
  hasActiveGoal?: boolean;
  /** LLM list for the Composer's inline picker. Drives the popover
   * under the model pill — see Composer's LLMPill. */
  llms?: ComposerLLMOption[];
  /** Called when the user picks an LLM from the inline dropdown. */
  onSelectLLM?: (index: number) => void;
  /** Runtime-specific footer hint in the Composer model dropdown. */
  llmConfigHint?: string;
  /** Opens Settings -> Models from the Composer model dropdown. */
  onConfigureModels?: () => void;
  /** When true, submitting opens Models instead of creating a session. */
  requiresModelConfig?: boolean;
  /** Fallback for pre-bridge / dev when `llms` is empty. */
  onOpenLLMSwitcher?: () => void;
  /**
   * Width mode from the TopBar toggle. EmptyState's hero block tracks
   * the same setting so the toggle has a visible effect even when no
   * conversation column exists yet (otherwise the user clicking the
   * button on the welcome screen sees nothing change — looks broken).
   * compact = 560 (intimate hero feel), wide = 1200 (matches MainView).
   */
  conversationWidth?: "compact" | "wide";
  conversationFontSize?: ConversationFontSize;
  /** Active project context for the next lazily-created session. */
  projectName?: string;
  /** Bumped by the host when a navigation action should return focus here. */
  focusTick?: number;
  /**
   * Workspace pulse the epigraph should frame: `silent` (no sessions),
   * `quiet` (sessions exist, none running), `working` (≥1 running). The
   * host computes this live, but the epigraph snapshots it once on
   * mount (see below) so the line frames the moment of arrival and does
   * not mutate under the user's gaze — the live pulse is the sidebar's
   * job, not this quiet line's. Defaults to `quiet`.
   */
  epigraphCondition?: EpigraphCondition;
  imagesEnabled?: boolean;
  onImageBlocked?: (reason: ImageBlockReason) => void;
}

/**
 * Empty state — what the user sees the first time they launch Galley
 * (and any time no session is active). Per DESIGN.md §7.
 *
 * Minimalist Linear-style: no heading, Composer is the focal point.
 * A quiet state-bound epigraph (Part A of philosophical-voice) sits
 * directly above the Composer. Placeholder carries the invitation in
 * product voice ("交代" implies handing a task to an agent — more
 * honest than "你想做什么？" Q&A framing). When a project filter is
 * active, the placeholder and context line name that project so the
 * right pane participates in project navigation instead of leaving the
 * signal hidden in Sidebar.
 */
export function EmptyState({
  llmDisplayName,
  onSubmit,
  onGoalSubmit,
  hasActiveGoal,
  llms,
  onSelectLLM,
  llmConfigHint,
  onConfigureModels,
  requiresModelConfig = false,
  onOpenLLMSwitcher,
  conversationWidth = "compact",
  conversationFontSize = "standard",
  projectName,
  focusTick = 0,
  epigraphCondition = "quiet",
  imagesEnabled = true,
  onImageBlocked,
}: EmptyStateProps) {
  const copy = useCopy();
  const composerRef = useRef<ComposerHandle>(null);
  // Freeze the epigraph condition on mount. EmptyState unmounts when the
  // user navigates into a conversation and remounts on return, so this
  // snapshot re-resolves on every fresh entry to the empty screen while
  // staying stable during a single sitting — even if a background
  // session starts/finishes and the host's live `epigraphCondition`
  // prop changes underneath. A live-mutating epigraph would read as a
  // status light (the sidebar's job) and pull attention to a line meant
  // to be quiet.
  const [frozenEpigraphCondition] = useState(() => epigraphCondition);
  const composerPlaceholder = projectName
    ? copy.empty.projectPlaceholder(projectName)
    : copy.empty.globalPlaceholder;

  useEffect(() => {
    if (focusTick > 0) composerRef.current?.focus();
  }, [focusTick]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center bg-app px-16 py-12"
      style={conversationTypographyStyle(conversationFontSize)}
    >
      <div
        className={cn(
          "w-full",
          conversationWidth === "wide" ? "max-w-[1200px]" : "max-w-[560px]",
        )}
      >
        <Epigraph condition={frozenEpigraphCondition} className="mb-5" />

        <Composer
          ref={composerRef}
          llmDisplayName={llmDisplayName}
          placeholder={composerPlaceholder}
          onSubmit={onSubmit}
          onGoalSubmit={onGoalSubmit}
          hasActiveGoal={hasActiveGoal}
          autoFocus
          llms={llms}
          onSelectLLM={onSelectLLM}
          llmConfigHint={llmConfigHint}
          onConfigureModels={onConfigureModels}
          requiresModelConfig={requiresModelConfig}
          onOpenLLMSwitcher={onOpenLLMSwitcher}
          imagesEnabled={imagesEnabled}
          onImageBlocked={onImageBlocked}
          staticHint={
            projectName ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <FolderOpen size={11} weight="thin" className="shrink-0" />
                <span className="min-w-0 truncate">
                  {copy.composer.willCreateIn(projectName)}
                </span>
              </span>
            ) : undefined
          }
        />

        {/* Below the composer, the GLOBAL empty state stays empty on
            purpose — no keyboard-shortcut chrome (first impression;
            the full list lives in Settings → Shortcuts) and no
            capability tips: the 2026-06-03 decision keeps capability
            discovery out of the empty state (a local-file tip was
            trialed here on 2026-07-04 and removed the same day — the
            saved-prompts presets already teach paste-a-path four
            times over). The one legitimate line is the project-mode
            consequence hint above ("will be created in X"), routed
            through the Composer's staticHint slot so it shares the
            in-session hint grammar; its folder icon is the
            content-level genre marker, parallel to kbd tokens in
            keyboard hints. */}
      </div>
    </div>
  );
}
