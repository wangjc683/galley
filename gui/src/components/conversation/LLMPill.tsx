import * as Popover from "@radix-ui/react-popover";
import { Check, Gear } from "@phosphor-icons/react";

import { ChatGptMark } from "@/components/conversation/ChatGptPlanMark";
import { TooltipLabel } from "@/components/ui/tooltip";
import { CHATGPT_USAGE_URL } from "@/lib/chatgpt-plan";
import { useCopy } from "@/lib/i18n";
import { isChatGptPlanOption, providerLabelAlwaysShown } from "@/lib/llm-menu";
import { openExternalUrl } from "@/lib/open-external";
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
 * Model pill — the current model name opening one popover: the model
 * list first, then a visually quieter settings deep-link (DESIGN.md
 * §4.4).
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
 * (PRD §13.2). The popover itself stays openable (the settings link
 * still works mid-run); model rows gray out under an inline hint. Only
 * the list-less fallback button is fully blocked, since its single
 * action IS the switch.
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
  phraseLead = false,
  popoverAlign = "start",
  chatGptPlanKeys,
}: {
  llmDisplayName: string;
  llms?: ComposerLLMOption[];
  onSelectLLM?: (index: number) => void;
  llmConfigHint?: string;
  onConfigureModels?: () => void;
  onOpenLLMSwitcher?: () => void;
  disabled: boolean;
  stopMode: boolean;
  /**
   * The pill leads a phrase whose next word is the EffortPill
   * (「grok-4.7 · high」): pad both sides to 4px so the words sit close
   * around the middle dot. Since the dot (2026-10-03) the inner side no
   * longer has to be squeezed, so the hover box is symmetric again: the
   * old `pl-2.5 pr-0.5` box jutted 10px left of the text, and its
   * effort twin 10px right (JC: 两边多了一块).
   */
  phraseLead?: boolean;
  /** How the popover lines up with the pill: its start (the card's
   * phrase sits left), or centred on it — the one-line composer's
   * phrase sits at the row's right, and a popover much wider than the
   * pill, lined up by its right edge, reached out to the left and did
   * not read as hanging from the pill (ruling 76; centred, it stays
   * inside the row on both sides). */
  popoverAlign?: "start" | "center";
  /** The `key`s of the models that spend the ChatGPT plan (Sign in
   * with ChatGPT, .scratch/chatgpt-siwc decisions 13, 14). Each carries
   * a 13px ChatGPT mark in ink-muted before its name: on the pill while
   * it is the current model (and 「使用 ChatGPT 订阅」 as the tooltip's
   * second line), and on its menu row; with any of them in the list,
   * the menu's action block gains 「ChatGPT 订阅 · 管理用量」. */
  chatGptPlanKeys?: ReadonlySet<string>;
}) {
  const copy = useCopy();
  const footerHint = llmConfigHint ?? copy.app.externalModelHint;
  // Verb only (2026-09-22): the model name is already on the pill, so
  // the tooltip no longer repeats it. With no caret on the pill
  // (2026-10-03) the hover box and this tooltip are its affordance.
  const title = stopMode
    ? copy.composer.cannotSwitchRunning
    : copy.composer.switchLlm;

  const pillClasses = (blocked: boolean) =>
    cn(
      "flex h-7 min-w-0 items-center gap-1 text-[12.5px] text-ink-soft",
      "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
      "hover:bg-hover hover:text-ink",
      "outline-none",
      "rounded-sm",
      phraseLead ? "px-1" : "px-2.5",
      blocked &&
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
          className={pillClasses(disabled)}
        >
          <span className="min-w-0 truncate">{llmDisplayName}</span>
        </button>
      </TooltipLabel>
    );
  }

  // The mark is not a model parameter but where the bill goes (decision
  // 13): the tooltip says so under the verb.
  const currentOnPlan = llms.some(
    (llm) => llm.isCurrent && isChatGptPlanOption(chatGptPlanKeys, llm),
  );
  const tooltip = currentOnPlan ? (
    <span className="flex flex-col gap-1">
      <span>{title}</span>
      <span>{copy.chatgptPlan.usingPlan}</span>
    </span>
  ) : (
    title
  );

  return (
    <Popover.Root>
      <TooltipLabel text={tooltip}>
        <Popover.Trigger asChild>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseFocus}
            aria-label={title}
            className={pillClasses(false)}
          >
            {/* No caret (2026-10-03): with the middle dot the phrase
                reads as two items, and the single tail caret sat in the
                effort pill's hover box — one half had an arrow, the
                other didn't. Neither does now; the hover box + tooltip
                are the affordance, as they already were for the model
                name since 09-22. */}
            {currentOnPlan && (
              <ChatGptMark className="size-[13px] text-ink-muted" />
            )}
            <span className="min-w-0 truncate">{llmDisplayName}</span>
          </button>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align={popoverAlign}
          side="top"
          sideOffset={6}
          onOpenAutoFocus={(event) => {
            // Sibling-popover convention (EffortPill / header
            // DisplayMenu): suppress Radix's open
            // autofocus. Every row here is tabIndex={-1}, so the focus
            // would land on this container itself and WebKit paints
            // its default blue ring around the whole popover on
            // keyboard opens. Focus stays on the pill trigger (which
            // has its own focus-visible ring); Esc-to-close is
            // unaffected (Radix listens at the document layer).
            event.preventDefault();
          }}
          className={cn(
            // Long model lists scroll instead of outgrowing the
            // viewport (conversation.md §4.4).
            // No min-width (2026-09-22): the longest model name sets
            // the width, the action rows are the floor (~110px); a
            // 160px floor left a 60px blank column beside short names.
            "galley-pop-in z-50 max-w-[320px] rounded-md border border-line bg-elevated p-1 shadow-elevated",
            "max-h-[min(60vh,360px)] overflow-y-auto outline-none",
          )}
        >
          <LLMMenu
            llms={llms}
            chatGptPlanKeys={chatGptPlanKeys}
            disabled={disabled}
            stopMode={stopMode}
            onSelectLLM={onSelectLLM}
            onConfigureModels={onConfigureModels}
            footerHint={footerHint}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The action block's rows: one quiet 11px register. */
const ACTION_ROW_CLASS = cn(
  "flex w-full items-center gap-1.5 rounded-callout px-1.5 py-1 text-left text-[11px] leading-[1.35] text-ink-muted/70",
  "hover:bg-hover hover:text-ink-soft",
);

/**
 * The model menu, inside LLMPill's popover: the model list, then the
 * action block (or, with nothing to act on, the footer hint). Exported
 * for its tests — a static render never opens the popover.
 */
export function LLMMenu({
  llms,
  chatGptPlanKeys,
  disabled,
  stopMode,
  onSelectLLM,
  onConfigureModels,
  footerHint,
}: {
  llms: ComposerLLMOption[];
  chatGptPlanKeys?: ReadonlySet<string>;
  disabled: boolean;
  stopMode: boolean;
  onSelectLLM?: (index: number) => void;
  onConfigureModels?: () => void;
  footerHint: string;
}) {
  const copy = useCopy();
  const labelAlwaysShown = providerLabelAlwaysShown(llms, chatGptPlanKeys);
  const hasPlanModels = llms.some((llm) =>
    isChatGptPlanOption(chatGptPlanKeys, llm),
  );
  return (
    <>
      {stopMode && (
        <div className="px-2.5 pb-1 pt-1 text-[10.5px] leading-[1.4] text-ink-muted/70">
          {copy.composer.cannotSwitchRunning}
        </div>
      )}
      {llms.map((llm, position) => {
        const providerLabel = llm.providerDisplayName?.trim();
        const onPlan = isChatGptPlanOption(chatGptPlanKeys, llm);
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
                "group/llm-option flex w-full min-w-0 items-center gap-2 rounded-callout px-2.5 py-1.5 text-left text-[12.5px] hover:bg-hover",
                llm.isCurrent ? "text-ink" : "text-ink-soft",
                disabled &&
                  "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
            >
              {/* Text flush left, check TRAILING (2026-09-22): a
                  leading check column reserved 22px on every row
                  for a glyph only one row draws, and pushed the
                  text 36px in from the popover edge. Trailing is the
                  web model-picker convention (ChatGPT / Claude /
                  Codex / Cursor); the provider label stays before
                  the check so the check always hugs the right edge.
                  A plan model's name has the pill's ChatGPT mark
                  before it (decision 14), the same 4px away. */}
              <span className="flex min-w-0 flex-1 items-center gap-1">
                {onPlan && (
                  <ChatGptMark className="size-[13px] text-ink-muted" />
                )}
                <span className="min-w-0 truncate">{llm.displayName}</span>
              </span>
              {providerLabel && (
                <span
                  className={cn(
                    "shrink-0 overflow-hidden truncate whitespace-nowrap text-[10px] leading-4 text-ink-muted/50",
                    labelAlwaysShown[position]
                      ? "max-w-[96px] opacity-100"
                      : "max-w-0 opacity-0 group-hover/llm-option:max-w-[96px] group-hover/llm-option:opacity-100",
                  )}
                >
                  {providerLabel}
                </span>
              )}
              {llm.isCurrent && (
                <Check
                  size={12}
                  weight="bold"
                  className="shrink-0 text-brand-strong"
                />
              )}
            </button>
          </Popover.Close>
        );
      })}
      {/* Action block: everything below the model list shares ONE
          quiet 11px register — the settings navigation, then the
          ChatGPT plan's usage page while any model is on the plan
          (decision 14: at the foot, not as a header in the list, where
          the rows under it read as the plan's). Two layers total:
          content vs actions, no intermediate type size. */}
      {onConfigureModels || hasPlanModels ? (
        <div className="mt-1 border-t border-line/60 px-1.5 pb-1 pt-1">
          {onConfigureModels && (
            <Popover.Close asChild>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={preventMouseFocus}
                onClick={onConfigureModels}
                className={ACTION_ROW_CLASS}
              >
                <Gear size={11} weight="thin" className="shrink-0" />
                <span>{copy.composer.configureModels}</span>
              </button>
            </Popover.Close>
          )}
          {hasPlanModels && (
            <Popover.Close asChild>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={preventMouseFocus}
                onClick={() => openExternalUrl(CHATGPT_USAGE_URL)}
                className={ACTION_ROW_CLASS}
              >
                <ChatGptMark className="size-[11px]" />
                <span>
                  {copy.chatgptPlan.planLabel} · {copy.chatgptPlan.manageUsage}
                </span>
              </button>
            </Popover.Close>
          )}
        </div>
      ) : (
        // Footer hint: addresses the "为什么这里没有 X 模型" question
        // right where it surfaces. Quiet metadata, not a CTA. Insets
        // keep what users saw while the mode row sat above it
        // (wrapper + inner padding summed: 12 / 8 / 6px).
        <div className="mt-1 border-t border-line/60 px-3 pb-1.5 pt-2 text-[10.5px] leading-[1.45] text-ink-muted/70">
          {footerHint}
        </div>
      )}
    </>
  );
}
