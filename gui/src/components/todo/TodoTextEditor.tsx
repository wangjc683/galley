import { useLayoutEffect, useRef } from "react";

import { isImeCompositionKeydown } from "@/lib/ime";
import { cn } from "@/lib/utils";

/**
 * The box a to-do's title or notes turn into when clicked in its open
 * row (main chat ticket 107, PRD ruling 153 point 4): in the words'
 * place, their type and their position, a focus ring around it, as tall
 * as its words (it grows as they do), no buttons. The caret lands where
 * the click was (`caret`), else at the end.
 *
 * - **A title** (`multiline` off): Enter saves, it never breaks a line
 *   (a pasted break is a space).
 * - **Notes** (`multiline`): Enter breaks a line, ⌘Enter (Ctrl+Enter
 *   off the Mac) saves.
 * - Either: Esc gives up, with the event's default prevented so the
 *   panel does not take the same key to fold the row; leaving the box
 *   saves. Enter, ⌘Enter and Esc wait for the IME (`isImeCompositionKeydown`:
 *   Enter confirming a pinyin candidate is not a save). Only one of
 *   save and give-up runs (an Enter's save, then the blur as the box
 *   goes, is one).
 *
 * The words are the row's (`value`, `onChange`): a failed save keeps
 * them, and the row says why under the box. `autoFocus` off for a box
 * back after a save that failed when you had already clicked elsewhere.
 */
export function TodoTextEditor({
  value,
  onChange,
  onSave,
  onCancel,
  multiline,
  caret,
  autoFocus = true,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** `keyboard`: by Enter or ⌘Enter, not by leaving the box. */
  onSave: (keyboard: boolean) => void;
  onCancel: () => void;
  multiline: boolean;
  caret: number | null;
  autoFocus?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const settled = useRef(false);
  const startCaret = useRef(caret);
  const startFocus = useRef(autoFocus);

  // As tall as its words, measured before paint so it never shows a
  // scrollbar or a jump.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.style.height = "0px";
    box.style.height = `${box.scrollHeight}px`;
  }, [value]);

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || !startFocus.current) return;
    box.focus();
    const at = Math.min(
      startCaret.current ?? box.value.length,
      box.value.length,
    );
    box.setSelectionRange(at, at);
  }, []);

  const save = (keyboard: boolean) => {
    if (settled.current) return;
    settled.current = true;
    onSave(keyboard);
  };
  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label={ariaLabel}
      spellCheck={false}
      onChange={(event) =>
        onChange(
          multiline
            ? event.target.value
            : event.target.value.replace(/\r?\n/g, " "),
        )
      }
      onKeyDown={(event) => {
        if (isImeCompositionKeydown(event)) return;
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        } else if (
          event.key === "Enter" &&
          (!multiline || event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          save(true);
        }
      }}
      onBlur={() => save(false)}
      className={cn(
        "block w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent p-0",
        "outline-none ring-2 ring-brand/30",
        className,
      )}
    />
  );
}
