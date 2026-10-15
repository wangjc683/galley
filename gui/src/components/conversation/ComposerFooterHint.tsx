import type { ReactNode } from "react";

import { resolveComposerHint } from "@/lib/composer-hint";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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
  isStopping: boolean;
  hasQueuedMessages: boolean;
  hasText: boolean;
  isSideQuestion: boolean;
  staticHint?: ReactNode;
  /** The one-line form insets the row to the input's text
   * (`ONE_LINE_HINT_CLASS`); under the card it is flush with the card. */
  className?: string;
}

/**
 * The single hint slot under every Composer (mt-1.5 / 11px / left:
 * flush with the card, at the input's text under the one-line form).
 * Renders, in priority order: the keyboard / state hint, or the
 * caller's staticHint. Returns null when empty so
 * the slot collapses. Which keyboard hint applies is policy, not
 * rendering — it lives in `lib/composer-hint.ts` beside the placeholder
 * policy it hands off to.
 */
export function ComposerFooterHint({
  showFooterHint,
  stopMode,
  isStopping,
  hasQueuedMessages,
  hasText,
  isSideQuestion,
  staticHint,
  className,
}: ComposerFooterHintProps) {
  const copy = useCopy();
  const hintKey = resolveComposerHint({
    showFooterHint,
    stopMode,
    isStopping,
    hasQueuedMessages,
    hasText,
    isSideQuestion,
  });
  const keyboardHint = hintKey ? copy.composer[hintKey] : null;
  // Keyboard hints get kbd-token styling; a caller-supplied staticHint
  // is already a ReactNode and renders as-is in the same slot.
  const footerHint: ReactNode = keyboardHint
    ? renderComposerHintWithKbd(keyboardHint)
    : (staticHint ?? null);
  if (!footerHint) return null;
  return (
    <div className={cn("mt-1.5 text-[11px] text-ink-muted", className)}>
      {footerHint}
    </div>
  );
}
