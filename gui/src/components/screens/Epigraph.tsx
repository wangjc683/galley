import {
  resolveEpigraph,
  type EpigraphCondition,
} from "@/lib/epigraphs";
import { useCopy, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface EpigraphProps {
  /**
   * Empty-state condition the line should speak to. Defaults to
   * `"fresh"`. Resolution is total — an unbound condition falls back
   * to the default entry, so callers never produce an empty render.
   */
  condition?: EpigraphCondition;
  className?: string;
  /**
   * When provided, the epigraph becomes quietly clickable: clicking
   * hands the caller a ready-made question about the line
   * (`copy.epigraph.explainPrompt` around the translated quote), which
   * EmptyState prefills into the Composer — the user presses Enter to
   * actually ask. The inscription look is preserved at rest; the
   * affordance only surfaces on hover/focus (slight ink lift +
   * pointer). PI §43 says meaning is use — clicking the line puts it
   * to use.
   *
   * Omitted (e.g. non-composer hosts) → renders exactly as before:
   * a non-interactive note.
   */
  onAskAbout?: (question: string) => void;
}

/**
 * Epigraph — Part A of the philosophical-voice feature. A single
 * state-bound Wittgenstein line shown above the empty-state Composer.
 *
 * Two lines: the translated line in the user's software language on
 * top, the German original on an always-on secondary line beneath it
 * (no hover gate, so touch / keyboard users see it too). The German
 * line sits one step quieter in weight/opacity.
 *
 * Visual weight is deliberately subordinate to the Composer — quiet,
 * serif, ink-muted; it must read as a quiet epigraph, not a header or
 * banner. Exactly one entry renders; there is no rotation or timer.
 * With `onAskAbout` it is a button whose rest state is
 * indistinguishable from the plain note — no chrome, no underline;
 * hover/focus is the only tell.
 *
 * See `docs/devlog/2026-06-03-philosophical-voice-and-austerity-copy.md`.
 */
export function Epigraph({
  condition = "fresh",
  className,
  onAskAbout,
}: EpigraphProps) {
  const language = useLanguage();
  const copy = useCopy();
  const { primary, de, cite } = resolveEpigraph(condition, language);

  const lines = (
    <>
      <p className="text-[12.5px] italic text-ink-muted transition-colors duration-(--motion-fast) group-hover:text-ink-soft">
        {primary}
      </p>
      <p
        lang="de"
        className="mt-0.5 text-[11px] italic text-ink-muted/55 transition-colors duration-(--motion-fast) group-hover:text-ink-muted/75"
      >
        {de}
      </p>
    </>
  );

  if (!onAskAbout) {
    return (
      <div
        role="note"
        aria-label={copy.epigraph.regionLabel}
        className={cn(
          "select-none text-center font-serif leading-[1.5]",
          className,
        )}
      >
        {lines}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={copy.epigraph.askAction}
      onClick={() => onAskAbout(copy.epigraph.explainPrompt(primary, cite, de))}
      className={cn(
        "group block w-full select-none text-center font-serif leading-[1.5]",
        "cursor-pointer outline-none",
        "rounded-sm focus-visible:ring-2 focus-visible:ring-brand/30",
        className,
      )}
    >
      {lines}
    </button>
  );
}
