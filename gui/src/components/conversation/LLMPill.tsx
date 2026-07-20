import * as Popover from "@radix-ui/react-popover";
import {
  CaretUp,
  Check,
  Gear,
  HandPalm,
  Lightning,
} from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import type { SessionApprovalMode } from "@/lib/approval-mode";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

export interface ComposerLLMOption {
  index: number;
  key?: string;
  name?: string;
  displayName: string;
  providerDisplayName?: string;
  isCurrent: boolean;
}

/**
 * Approval-mode slice of the conversation-config pill. The mode icon
 * (⚡ 自动执行 / ✋ 逐步审批) renders in front of the model name, and
 * the popover hosts a quiet mode section under the model list —
 * approval mode is per-session conversation config, same capsule as
 * the model (2026-07-20, fourth revision; see conversation.md §4.4).
 */
export interface ComposerApprovalModeState {
  /** Effective mode for the surface (override ?? app-wide default). */
  mode: SessionApprovalMode;
  /**
   * Switch the session's mode. Override = deviation: the data layer
   * clears the override when the picked mode equals the app default,
   * so a switch-and-back round trip leaves no pinned residue.
   */
  onSelectMode: (mode: SessionApprovalMode) => void;
}

/**
 * Conversation-config pill — the current model (with the session's
 * approval-mode icon in front) opening one popover for both concerns:
 * model list first, then a visually quieter approval-mode section,
 * then settings deep-links (DESIGN.md §4.4).
 *
 * Two modes:
 *   - `llms` provided (production): renders a Radix Popover with the
 *     model list, mirroring ChatGPT / Claude's inline picker UX.
 *   - `llms` empty / undefined: falls back to `onOpenLLMSwitcher`
 *     callback (e.g. opens Command Palette) so pre-bridge states
 *     and dev tooling still have a click target.
 *
 * `stopMode` (agent mid-run) blocks MODEL switching only — switching
 * LLMs while a turn is in flight would race the in-progress request
 * (PRD §13.2). The popover itself stays openable when an approval
 * section is present, because flipping a running session to 逐步审批
 * is exactly the "I want to watch this now" move (`set_yolo_mode`
 * applies immediately). Model rows gray out with an inline hint.
 */
export function LLMPill({
  llmDisplayName,
  llms,
  onSelectLLM,
  llmConfigHint,
  onConfigureModels,
  onOpenLLMSwitcher,
  approvalMode,
  disabled,
  stopMode,
}: {
  llmDisplayName: string;
  llms?: ComposerLLMOption[];
  onSelectLLM?: (index: number) => void;
  llmConfigHint?: string;
  onConfigureModels?: () => void;
  onOpenLLMSwitcher?: () => void;
  approvalMode?: ComposerApprovalModeState;
  disabled: boolean;
  stopMode: boolean;
}) {
  const copy = useCopy();
  const modeCopy = copy.composer.approvalMode;
  const footerHint = llmConfigHint ?? copy.app.externalModelHint;
  const currentModeName = approvalMode
    ? approvalMode.mode === "auto"
      ? modeCopy.autoName
      : modeCopy.approvalName
    : null;
  const title = stopMode
    ? copy.composer.cannotSwitchRunning
    : copy.composer.switchCurrent(llmDisplayName);
  const ariaLabel = currentModeName
    ? `${title} · ${modeCopy.switchTooltip(currentModeName)}`
    : title;
  // With an approval section the popover must stay reachable mid-run;
  // only pure-LLM pills keep the old "blocked = won't open" behavior.
  const blockOpen = disabled && !approvalMode;

  const modeIcon = approvalMode ? (
    approvalMode.mode === "auto" ? (
      <Lightning size={12} weight="thin" className="shrink-0" />
    ) : (
      <HandPalm size={12} weight="thin" className="shrink-0" />
    )
  ) : null;

  const pillClasses = cn(
    "flex h-7 min-w-0 items-center gap-1 text-[12.5px] text-ink-soft",
    "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-[0.5px]",
    "hover:bg-hover hover:text-ink",
    "outline-none",
    "rounded-sm px-2.5",
    blockOpen &&
      "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-ink-soft active:translate-y-0",
  );

  // Fallback path — no llms list available, defer to the parent's
  // legacy handler. Same visual treatment as the popover trigger.
  // Radix tooltip (not native title): design-system rule, and the
  // aria-disabled pattern keeps it reachable while the run blocks
  // switching — the tooltip carries exactly that explanation.
  if (!llms || llms.length === 0) {
    return (
      <TooltipLabel text={title}>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={preventMouseFocus}
          onClick={() => {
            if (disabled) return;
            onOpenLLMSwitcher?.();
          }}
          aria-disabled={disabled || undefined}
          aria-label={ariaLabel}
          className={pillClasses}
        >
          {modeIcon}
          <span className="min-w-0 truncate">{llmDisplayName}</span>
          <CaretUp size={10} weight="thin" className="text-ink-muted" />
        </button>
      </TooltipLabel>
    );
  }

  const displayNameCounts = new Map<string, number>();
  for (const llm of llms) {
    const displayNameKey = llm.displayName.trim();
    displayNameCounts.set(
      displayNameKey,
      (displayNameCounts.get(displayNameKey) ?? 0) + 1,
    );
  }

  // The mode section is ONE verb row: switch to the other mode. The
  // current value is already on the trigger icon; popover rows are
  // actions, not state displays (fifth revision — two state rows plus
  // two settings links made the subordinate section nearly as tall as
  // the model list it hangs under).
  const otherMode: SessionApprovalMode | null = approvalMode
    ? approvalMode.mode === "auto"
      ? "approval"
      : "auto"
    : null;
  const otherModeName =
    otherMode === "approval" ? modeCopy.approvalName : modeCopy.autoName;
  const otherModeDescription =
    otherMode === "approval"
      ? modeCopy.approvalDescription
      : modeCopy.autoDescription;

  return (
    <Popover.Root>
      <TooltipLabel text={title}>
        <Popover.Trigger asChild>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseFocus}
            // preventDefault stops Radix from opening the popover while
            // switching is blocked (its composed handlers respect
            // defaultPrevented); aria-disabled keeps the explanatory
            // tooltip reachable, unlike a real `disabled`.
            onClick={(e) => {
              if (blockOpen) e.preventDefault();
            }}
            aria-disabled={blockOpen || undefined}
            aria-label={ariaLabel}
            className={pillClasses}
          >
            {modeIcon}
            <span className="min-w-0 truncate">{llmDisplayName}</span>
            <CaretUp size={10} weight="thin" className="text-ink-muted" />
          </button>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="top"
          sideOffset={6}
          className={cn(
            // Long model lists scroll instead of outgrowing the
            // viewport (conversation.md §4.4).
            "galley-pop-in z-50 min-w-[200px] max-w-[320px] rounded-md border border-line bg-elevated p-1 shadow-elevated",
            "max-h-[min(60vh,360px)] overflow-y-auto",
          )}
        >
          {stopMode && (
            <div className="px-2.5 pb-1 pt-1 text-[10.5px] leading-[1.4] text-ink-muted/70">
              {copy.composer.cannotSwitchRunning}
            </div>
          )}
          {llms.map((llm) => {
            const providerLabel = llm.providerDisplayName?.trim();
            const isDuplicateDisplayName =
              (displayNameCounts.get(llm.displayName.trim()) ?? 0) > 1;
            return (
              <Popover.Close asChild key={llm.index}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={preventMouseFocus}
                  onClick={() => {
                    if (disabled) return;
                    onSelectLLM?.(llm.index);
                  }}
                  aria-disabled={disabled || undefined}
                  className={cn(
                    "group/llm-option flex w-full min-w-0 items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[12.5px] hover:bg-hover",
                    llm.isCurrent ? "text-ink" : "text-ink-soft",
                    disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                >
                  <span className="flex w-3.5 shrink-0 items-center justify-center">
                    {llm.isCurrent && (
                      <Check
                        size={12}
                        weight="bold"
                        className="text-brand-strong"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {llm.displayName}
                  </span>
                  {providerLabel && (
                    <span
                      className={cn(
                        "shrink-0 overflow-hidden truncate whitespace-nowrap text-[10px] leading-4 text-ink-muted/50",
                        isDuplicateDisplayName
                          ? "max-w-[96px] opacity-100"
                          : "max-w-0 opacity-0 group-hover/llm-option:max-w-[96px] group-hover/llm-option:opacity-100",
                      )}
                    >
                      {providerLabel}
                    </span>
                  )}
                </button>
              </Popover.Close>
            );
          })}
          {/* Action block: everything below the model list shares ONE
              quiet 11px register — the mode verb row (switch to the
              OTHER mode; the current one is on the trigger icon, and
              popover rows are actions, not state displays), then the
              settings navigation. Two layers total: content vs
              actions — no intermediate type size, no conditional
              rows (override semantics are handled invisibly by the
              deviation-normalizing data layer; the app-wide default
              is edited in Settings only). */}
          {(approvalMode && otherMode) || onConfigureModels ? (
            <div className="mt-1 border-t border-line/60 px-1.5 pb-1 pt-1">
              {approvalMode && otherMode && (
                <Popover.Close asChild>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={preventMouseFocus}
                    onClick={() => approvalMode.onSelectMode(otherMode)}
                    aria-label={`${modeCopy.switchTo(otherModeName)} — ${otherModeDescription}`}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-[11px] leading-[1.35] text-ink-muted/70",
                      "hover:bg-hover hover:text-ink-soft",
                    )}
                  >
                    {otherMode === "auto" ? (
                      <Lightning size={11} weight="thin" className="shrink-0" />
                    ) : (
                      <HandPalm size={11} weight="thin" className="shrink-0" />
                    )}
                    <span className="min-w-0 truncate">
                      {modeCopy.switchTo(otherModeName)}
                    </span>
                  </button>
                </Popover.Close>
              )}
              {onConfigureModels ? (
                <Popover.Close asChild>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={preventMouseFocus}
                    onClick={onConfigureModels}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-[11px] leading-[1.35] text-ink-muted/70",
                      "hover:bg-hover hover:text-ink-soft",
                    )}
                  >
                    <Gear size={11} weight="thin" className="shrink-0" />
                    <span>{copy.composer.configureModels}</span>
                  </button>
                </Popover.Close>
              ) : (
                // Footer hint: addresses the "为什么这里没有 X 模型"
                // question right where it surfaces. Quiet metadata,
                // not a CTA.
                <div className="px-1.5 pb-0.5 pt-1 text-[10.5px] leading-[1.45] text-ink-muted/70">
                  {footerHint}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-1 border-t border-line/60 px-2.5 pb-1 pt-1.5 text-[10.5px] leading-[1.45] text-ink-muted/70">
              {footerHint}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
