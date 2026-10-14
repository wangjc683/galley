import { useCopy } from "@/lib/i18n";
import type { AssistantLine } from "@/lib/spaces-trial";
import { truncationFadeRef } from "@/lib/truncation-fade";
import { cn } from "@/lib/utils";

/**
 * TEMPORARY (ticket 16) — the assistant's mark until it has a real
 * likeness (ruling 61): a brand-apricot disc carrying the masthead
 * wordmark's italic Newsreader 「G」, no image asset. The letter is a
 * deep shade of the same apricot rather than ink, so it reads in both
 * themes (brand stays light in dark mode, where ink turns light).
 */
export function AssistantAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-role="assistant-avatar"
      className={cn(
        "inline-flex size-7 shrink-0 select-none items-center justify-center rounded-full bg-brand",
        "font-serif text-[17px] font-medium italic leading-none",
        "text-[color-mix(in_oklab,var(--color-brand)_22%,black)]",
        className,
      )}
    >
      {/* The italic leans right and the cap sits high: a pixel back and
          two down centre its ink in the disc (measured on screen). */}
      <span className="-translate-x-px translate-y-0.5">G</span>
    </span>
  );
}

/**
 * TEMPORARY (ticket 16) — the assistant space's header in the title's
 * place: avatar, its name 「Galley」, and under the name what it is doing
 * now (`assistantStatusLine`: the main chat row's subline — running,
 * waiting for you, an error, a subtask's too — and nothing at rest). No
 * title menu: there is nothing to rename and no session to act on.
 *
 * The line takes the row subline's register and tones (11px, brand while
 * running, warning, error) and its fade when cut. Every piece carries
 * the drag region (it does not bubble), so the header still drags the
 * window from its left.
 */
export function AssistantIdentity({ line }: { line: AssistantLine | null }) {
  const copy = useCopy();
  return (
    <span
      data-tauri-drag-region
      data-role="assistant-identity"
      className="flex min-w-0 items-center gap-2"
    >
      <AssistantAvatar />
      <span
        data-tauri-drag-region
        className="flex min-w-0 flex-col justify-center"
      >
        <span
          data-tauri-drag-region
          className="truncate text-[13px] font-medium leading-4 text-ink"
        >
          {copy.spaces.assistantName}
        </span>
        {line && (
          <span
            data-tauri-drag-region
            data-role="assistant-status-line"
            ref={truncationFadeRef}
            className={cn(
              "truncate-fade text-[11px] leading-[1.4] tabular-nums",
              line.tone === "error"
                ? "text-error"
                : line.tone === "warning"
                  ? "text-warning"
                  : "text-brand-strong",
            )}
          >
            {line.text}
          </span>
        )}
      </span>
    </span>
  );
}
