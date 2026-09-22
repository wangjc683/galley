import * as Popover from "@radix-ui/react-popover";
import { CaretUp, Check } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import {
  COMPOSER_EFFORT_TIERS,
  EFFORT_DEFAULT_ROW,
  effortPillState,
} from "@/lib/reasoning-effort";
import { cn } from "@/lib/utils";

/**
 * Reasoning-effort slice of the Composer's pill row. Per-session
 * nullable override; null = follow the selected model's configured
 * tier (see `lib/reasoning-effort.ts` for the three rules).
 */
export interface ComposerReasoningEffortState {
  /** override ?? configured. null = nothing set anywhere (`默认`). */
  effective: string | null;
  /** The tier the selected model's configuration carries. */
  configured: string | null;
  /** This session's override, or null while it follows the model. */
  override: string | null;
  /**
   * Pick a tier, or null for `默认`. Override = deviation: the data
   * layer clears the override when the pick equals the configured
   * tier, so a switch-and-back round trip leaves no residue.
   */
  onSelect: (value: string | null) => void;
}

/**
 * Reasoning-effort pill — an INDEPENDENT pill immediately right of the
 * LLMPill, the mature-product "model picker + effort picker" pairing
 * (2026-09-22, after the live test rejected hiding the tiers inside the
 * model popover: with a few models it read as hanging off the last
 * model row, and the empty state never showed it at all).
 *
 * Opposite call from approval mode, which IS merged into the LLMPill:
 * approval is a binary switch that almost never moves, effort is a knob
 * users reach for mid-run and its value carries information (HIGH =
 * slower, pricier), which earns its own place.
 *
 * Shape notes:
 *   - Always present once a model is selected — no flicker in / out.
 *     `默认` covers "nothing set anywhere".
 *   - Same typeface and size as the model name next door, one ink
 *     step lighter (`text-ink-muted/80`, caret matched; tier labels from the Models
 *     settings copy) — the model is identity, the tier its parameter:
 *     JC's second live round rejected the settings-badge chip glyph
 *     here — beside a plain model name it was a third type style, and
 *     the pair read as clutter. Following vs overriding is NOT drawn
 *     on the trigger (a muted/full ink split at this size read as a
 *     broken button); the tooltip / aria label carries it.
 *   - Forms ONE phrase with the LLMPill, Codex-style: 「⚡ grok-4.7
 *     High ^」 — the model pill drops its own caret (`phraseLead`), the
 *     phrase carries a single caret here at its end, and the two sit a
 *     word space apart (their inner paddings, no row gap between them).
 *     Zero carets was considered and rejected: without one the phrase
 *     reads as a status line, every mature product keeps a chevron on
 *     the model picker, and the Goal ceiling pill next door keeps its
 *     caret by DESIGN rule (arrow points where the popover opens).
 *   - Usable mid-run: the engine reads the value per request, so a
 *     change applies to the next call. The LLM switch lock does not
 *     reach here.
 */
export function EffortPill({
  effective,
  configured,
  override,
  onSelect,
}: ComposerReasoningEffortState) {
  const copy = useCopy();
  const effortCopy = copy.composer.reasoningEffort;
  const tierCopy = copy.settings.models;
  const { showDefaultRow, currentRow, following } = effortPillState({
    override,
    effective,
    configured,
  });
  // Tier labels are the Models settings' words (`Low` / `Medium` /
  // `High` / `XHigh`) set in lowercase: a capital first letter gave the
  // tier the cap height and stroke mass of a word, so next to an
  // all-lowercase model name (「grok-4.7」) it read heavier than the
  // model — the hierarchy depended on which model was picked. Lowercase
  // keeps the tier an x-height word under any model name (fifth live
  // round, 2026-09-22). The settings editor keeps its capitalized
  // labels; this is the composer's own register. A tier outside the
  // composer's four (set in the model configuration) falls back to its
  // raw value, which is lowercase already.
  const tierLabels: Record<string, string> = {
    low: tierCopy.reasoningLow.toLowerCase(),
    medium: tierCopy.reasoningMedium.toLowerCase(),
    high: tierCopy.reasoningHigh.toLowerCase(),
    xhigh: tierCopy.reasoningXHigh.toLowerCase(),
  };
  const triggerLabel =
    effective === null
      ? effortCopy.default
      : (tierLabels[effective] ?? effective);
  // Tooltip is a bare verb (2026-09-22: the following / override split
  // was ruled not worth showing anywhere visible); the aria label keeps
  // it for screen readers.
  const tooltip = effortCopy.tooltip;
  const ariaLabel = following
    ? effortCopy.ariaFollowing
    : effortCopy.ariaOverride;

  // `默认` only appears when the model configuration has no explicit
  // tier — with one there is nothing to "follow" that isn't already a
  // row below.
  const rows: { key: string; value: string | null; label: string }[] = [
    ...(showDefaultRow
      ? [
          {
            key: EFFORT_DEFAULT_ROW,
            value: null,
            label: effortCopy.default,
          },
        ]
      : []),
    ...COMPOSER_EFFORT_TIERS.map((tier) => ({
      key: tier,
      value: tier,
      label: tierLabels[tier],
    })),
  ];

  return (
    <Popover.Root>
      <TooltipLabel text={tooltip}>
        <Popover.Trigger asChild>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseFocus}
            aria-label={ariaLabel}
            className={cn(
              // Same pill grammar as the LLMPill trigger next door.
              // One register below the model name (identity) — the
              // tier is a parameter of it: same 12.5px so the row's
              // baseline and caret rhythm hold, ink one step lighter,
              // hover lifts it to the model pill's resting ink. A
              // constant hierarchy, not a state signal (the rejected
              // muted/full split flipped with the override).
              "flex h-7 shrink-0 items-center gap-1 text-[12.5px] text-ink-muted/80",
              "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
              "hover:bg-hover hover:text-ink-soft",
              "outline-none",
              // Phrase tail: `pl-0.5` mirrors the LLMPill's `pr-0.5` (its
              // `phraseLead` mode), so the visible gap is one word
              // space at 12.5px (4px, Codex-tight) and the two hover
              // boxes meet without overlapping. Tune the pair together.
              "rounded-sm pl-0.5 pr-2.5",
            )}
          >
            <span className="min-w-0 truncate">{triggerLabel}</span>
            <CaretUp size={10} weight="thin" className="text-ink-muted/80" />
          </button>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="top"
          sideOffset={6}
          onOpenAutoFocus={(event) => {
            // Sibling-popover convention (LLMPill / ThemePreferenceMenu):
            // suppress Radix's open autofocus. Every row is
            // tabIndex={-1}, so focus would land on the container and
            // WebKit paints its default ring around the whole popover.
            event.preventDefault();
          }}
          className={cn(
            // No min-width: the four tier words set the width (~100px);
            // a floor only bought empty space (2026-09-22).
            "galley-pop-in z-50 rounded-md border border-line bg-elevated p-1 shadow-elevated",
            "outline-none",
          )}
        >
          {rows.map((row) => {
            const isCurrent = row.key === currentRow;
            return (
              <Popover.Close asChild key={row.key}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={preventMouseFocus}
                  onClick={() => {
                    // Picking what is already in force is a no-op (it
                    // would otherwise round-trip a write for nothing).
                    if (isCurrent) return;
                    onSelect(row.value);
                  }}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-callout px-2.5 py-1.5 text-left text-[12.5px] hover:bg-hover",
                    isCurrent ? "text-ink" : "text-ink-soft",
                  )}
                >
                  {/* Same row grammar as the model popover: text flush
                      left, check trailing on the current row only. */}
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {isCurrent && (
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
