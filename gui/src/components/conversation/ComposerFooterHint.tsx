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
  isSideQuestion,
  showByTheWayRequiredHint,
  effectiveGoalArmed,
  goalBlockedHintVisible,
  staticHint,
}: ComposerFooterHintProps) {
  const copy = useCopy();
  const shouldShowByTheWayRequiredHint =
    showByTheWayRequiredHint && stopMode && !isSideQuestion;
  // Division of labor while the agent runs: the placeholder owns the
  // /btw lesson (it sits exactly where the prefix gets typed and is
  // itself the format example), so the persistent hint must NOT
  // repeat it — it degrades to pure status ("运行中…"). "Enter 发送"
  // would be a lie here (plain Enter is gated), EXCEPT once /btw is
  // staged: then Enter really sends again, so the true keyboard hint
  // comes back. The transient byTheWayPrefixHint stays as the
  // correction after a blocked Enter attempt.
  const keyboardHint = showFooterHint
    ? shouldShowByTheWayRequiredHint
      ? copy.composer.byTheWayPrefixHint
      : stopMode
        ? isSideQuestion
          ? copy.composer.enterHint
          : copy.composer.runningHint
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
