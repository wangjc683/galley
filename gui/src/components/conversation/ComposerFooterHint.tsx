import type { ReactNode } from "react";

import { useCopy } from "@/lib/i18n";

const COMPOSER_HINT_KBD = new Set(["Shift+Enter", "Enter", "/btw"]);

/** Render a composer footer hint, styling known keyboard / command
 * tokens (Enter, Shift+Enter, /btw) in mono so they read as keys
 * rather than prose. The tokens are language-invariant, so one
 * splitter works across zh / en copy. */
function renderComposerHintWithKbd(text: string): ReactNode {
  return text.split(/(Shift\+Enter|Enter|\/btw)/g).map((part, i) =>
    COMPOSER_HINT_KBD.has(part) ? (
      <span key={i} className="font-mono text-ink-soft">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

interface ComposerFooterHintProps {
  showFooterHint: boolean;
  stopMode: boolean;
  hasText: boolean;
  isSideQuestion: boolean;
  showByTheWayRequiredHint: boolean;
  effectiveGoalArmed: boolean;
  goalBlockedHintVisible: boolean;
  staticHint?: ReactNode;
}

/**
 * The single hint slot under every Composer (mt-1.5 / 11px / left).
 * Renders, in priority order: the goal-blocked warning, the keyboard /
 * state hint, or the caller's staticHint. Returns null when empty so
 * the slot collapses.
 */
export function ComposerFooterHint({
  showFooterHint,
  stopMode,
  hasText,
  isSideQuestion,
  showByTheWayRequiredHint,
  effectiveGoalArmed,
  goalBlockedHintVisible,
  staticHint,
}: ComposerFooterHintProps) {
  const copy = useCopy();
  const shouldShowByTheWayRequiredHint =
    showByTheWayRequiredHint && stopMode && !isSideQuestion;
  // The slot only ever lists keys that are live right now, so while the
  // agent runs it degrades exactly as far as stopMode gates — it never
  // becomes pure status. Three running states, and the placeholder and
  // this slot hand off between them rather than speaking at once:
  //   empty draft — the placeholder owns the /btw lesson (it sits where
  //     the prefix gets typed and is itself the format example), so the
  //     slot must not repeat the token. Plain Enter is gated but
  //     Shift+Enter is not (handleKeyDown intercepts Enter only without
  //     shift), so the legend keeps the half that stays true.
  //   typing — the placeholder is gone; the slot takes over and states
  //     what Enter needs, pre-empting the block instead of only
  //     correcting it afterwards.
  //   /btw staged — Enter really sends again, so the full hint returns.
  // The transient byTheWayPrefixHint stays as the correction after a
  // blocked Enter attempt.
  const keyboardHint = showFooterHint
    ? shouldShowByTheWayRequiredHint
      ? copy.composer.byTheWayPrefixHint
      : stopMode
        ? isSideQuestion
          ? copy.composer.enterHint
          : hasText
            ? copy.composer.byTheWaySendHint
            : copy.composer.newlineHint
        : effectiveGoalArmed
          ? // Armed changes what Enter does (opens the Goal preview, not
            // send) — with the wide "启动 Goal" pill gone, this hint and
            // the button tooltip carry that semantic.
            copy.composer.startGoalWithEnter
          : copy.composer.enterHint
    : null;
  // Keyboard hints get kbd-token styling; a caller-supplied staticHint
  // is already a ReactNode and renders as-is in the same slot.
  const footerHint: ReactNode = goalBlockedHintVisible ? (
    <span className="text-warning">{copy.composer.goalBlockedByActive}</span>
  ) : keyboardHint ? (
    renderComposerHintWithKbd(keyboardHint)
  ) : (
    (staticHint ?? null)
  );
  if (!footerHint) return null;
  return <div className="mt-1.5 text-[11px] text-ink-muted">{footerHint}</div>;
}
