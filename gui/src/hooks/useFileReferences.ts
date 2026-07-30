import { useCallback, useEffect, useRef } from "react";

import { stat } from "@tauri-apps/plugin-fs";

import {
  expandFileRefPlaceholders as expandRefs,
  fileRefPlaceholder,
  insertFileRefPlaceholders,
  type FileRefEntry,
  type FileRefKind,
} from "@/lib/composer-file-ref";
import { dropPathBasename } from "@/lib/file-drop";

/**
 * Owns the Composer's file-reference concern: the registry mapping each
 * placeholder id → absolute path, the monotonic id counter, and the
 * post-commit caret restoration. Dropped / picked non-image paths become
 * `[File #N: name]` placeholders at the caret; submit re-expands them via
 * `expandFileRefPlaceholders`. Structural twin of `usePasteFold` — same
 * registry-in-refs design, same caret trick, same reset contract.
 *
 * Drafts store expanded text (lib/composer-draft.ts), so this registry
 * needs no park/restore: a restored draft shows full paths, placeholder
 * cosmetics are lost, content is not — identical to paste-fold's
 * behavior.
 */
export function useFileReferences({
  text,
  textareaRef,
  applyValue,
}: {
  /** Current textarea value — trigger for the post-commit caret effect. */
  text: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Commit a new value (uncontrolled setState + onChange notify — for a
   * controlled caller the onChange half is the commit). */
  applyValue: (next: string) => void;
}) {
  const refsRef = useRef<Map<number, FileRefEntry>>(new Map());
  const counterRef = useRef(0);
  const pendingCursorRef = useRef<number | null>(null);

  // Post-commit caret restoration — setSelectionRange inside the drop
  // handler would race React's commit of the spliced value (see
  // usePasteFold for the original rationale).
  useEffect(() => {
    const pos = pendingCursorRef.current;
    if (pos !== null && textareaRef.current) {
      textareaRef.current.setSelectionRange(pos, pos);
      pendingCursorRef.current = null;
    }
  }, [text, textareaRef]);

  /**
   * Register `paths` and splice their placeholders into the textarea —
   * at the caret when the textarea has focus, appended at the end
   * otherwise (a drop can land while focus is elsewhere; appending beats
   * inserting at a stale caret the user can't see). Each path is
   * stat'ed to pick the File / Folder label; stat failures (fs scope,
   * races) default to File — the label is cosmetic, the path is what
   * expands.
   */
  const insertPathReferences = async (paths: string[]) => {
    if (paths.length === 0) return;
    const entries = await Promise.all(
      paths.map(async (path) => {
        let kind: FileRefKind = "file";
        try {
          if ((await stat(path)).isDirectory) kind = "folder";
        } catch {
          // keep "file"
        }
        return { path, kind };
      }),
    );
    const el = textareaRef.current;
    // The textarea value is the freshest text (the `text` prop in this
    // closure may predate the awaits above).
    const current = el ? el.value : text;
    const focused = el !== null && document.activeElement === el;
    const start = focused ? el.selectionStart : current.length;
    const end = focused ? el.selectionEnd : current.length;
    const placeholders = entries.map(({ path, kind }) => {
      const id = ++counterRef.current;
      const placeholder = fileRefPlaceholder(kind, id, dropPathBasename(path));
      refsRef.current.set(id, { placeholder, path });
      return placeholder;
    });
    const { next, caret } = insertFileRefPlaceholders({
      text: current,
      start,
      end,
      placeholders,
    });
    pendingCursorRef.current = caret;
    applyValue(next);
    // A drop doesn't move focus; claim it so the user can keep typing
    // right after the reference (the caret effect above lands post-commit).
    el?.focus();
  };

  // Stable identities (only read refs) so effect / handle callers can
  // list them in deps without churn — same contract as usePasteFold.
  const expandFileRefPlaceholders = useCallback(
    (s: string): string => expandRefs(s, refsRef.current),
    [],
  );

  /** Drop every entry and reset the counter. Called after submit and on
   * programmatic prefill, alongside resetPasteRegistry. */
  const resetFileRefRegistry = useCallback(() => {
    refsRef.current.clear();
    counterRef.current = 0;
  }, []);

  return {
    insertPathReferences,
    expandFileRefPlaceholders,
    resetFileRefRegistry,
  };
}
