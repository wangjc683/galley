import * as Popover from "@radix-ui/react-popover";
import { CaretUp, Check, Gear } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
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
 * LLM pill — clickable label showing the current model, opens a
 * dropdown of available models for one-click switching (DESIGN.md §4.4).
 *
 * Two modes:
 *   - `llms` provided (production): renders a Radix Popover with the
 *     model list, mirroring ChatGPT / Claude's inline picker UX.
 *   - `llms` empty / undefined: falls back to `onOpenLLMSwitcher`
 *     callback (e.g. opens Command Palette) so pre-bridge states
 *     and dev tooling still have a click target.
 *
 * `stopMode` (agent mid-run) disables both — switching LLMs while a
 * turn is in flight would race the in-progress request and produce
 * inconsistent state. PRD §13.2.
 */
export function LLMPill({
  llmDisplayName,
  llms,
  onSelectLLM,
  llmConfigHint,
  onConfigureModels,
  onOpenLLMSwitcher,
  disabled,
  stopMode,
}: {
  llmDisplayName: string;
  llms?: ComposerLLMOption[];
  onSelectLLM?: (index: number) => void;
  llmConfigHint?: string;
  onConfigureModels?: () => void;
  onOpenLLMSwitcher?: () => void;
  disabled: boolean;
  stopMode: boolean;
}) {
  const copy = useCopy();
  const footerHint = llmConfigHint ?? copy.app.externalModelHint;
  const title = stopMode
    ? copy.composer.cannotSwitchRunning
    : copy.composer.switchCurrent(llmDisplayName);

  const pillClasses = cn(
    "flex h-7 min-w-0 items-center gap-1 text-[12.5px] text-ink-soft",
    "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-[0.5px]",
    "hover:bg-hover hover:text-ink",
    "outline-none",
    "rounded-sm px-2.5",
    disabled &&
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
          aria-label={title}
          className={pillClasses}
        >
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
              if (disabled) e.preventDefault();
            }}
            aria-disabled={disabled || undefined}
            aria-label={title}
            className={pillClasses}
          >
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
                  onClick={() => onSelectLLM?.(llm.index)}
                  className={cn(
                    "group/llm-option flex w-full min-w-0 items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[12.5px] hover:bg-hover",
                    llm.isCurrent ? "text-ink" : "text-ink-soft",
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
          {/* Footer hint: addresses the "为什么这里没有 X 模型"
              question right where it surfaces. Visually quiet on
              purpose — supplementary metadata, not a CTA. */}
          {onConfigureModels ? (
            <div className="mt-1 border-t border-line/60 px-1.5 pb-1 pt-1">
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
