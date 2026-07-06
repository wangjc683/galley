import { useEffect, useRef, useState } from "react";

import { isImeCompositionKeydown } from "@/lib/ime";
import { cn } from "@/lib/utils";

/**
 * Inline session-title editor — the rename input shared by the two
 * places a session title can be renamed in place: the MainHeader
 * title menu and a Sidebar session row. Both had a byte-identical copy;
 * this is the single source of truth.
 *
 * Behavior (identical across call sites):
 *   - Auto-focus + select-all on mount (Notion / Linear style)
 *   - Enter → commit; Esc → cancel; blur → commit ("click outside
 *     doesn't lose work")
 *   - settledRef guards the Enter-then-blur double-fire so onCommit /
 *     onCancel runs at most once
 *   - IME composition Enter is ignored (isImeCompositionKeydown)
 *
 * The two call sites differ only in chrome, gated by props:
 *   - `dragRegionOptOut` (MainHeader): the header is a Tauri
 *     `data-tauri-drag-region`, which captures mousedown for window
 *     dragging. Opt this input out so it can focus normally.
 *   - `stopRowActivation` (Sidebar): the parent row is the
 *     session-switch click target, so swallow click / mousedown /
 *     contextmenu to keep editing from activating the row.
 *   - `className`: caller supplies layout (rounding, padding, width);
 *     the shared base owns the bg / ring / border / type.
 */
export function SessionTitleEditor({
  initial,
  onCommit,
  onCancel,
  className,
  dragRegionOptOut = false,
  stopRowActivation = false,
}: {
  initial: string;
  onCommit: (newTitle: string) => void;
  onCancel: () => void;
  className?: string;
  dragRegionOptOut?: boolean;
  stopRowActivation?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const settledRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(value);
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      data-tauri-drag-region={dragRegionOptOut ? "false" : undefined}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (isImeCompositionKeydown(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
      onClick={stopRowActivation ? (e) => e.stopPropagation() : undefined}
      onMouseDown={stopRowActivation ? (e) => e.stopPropagation() : undefined}
      onContextMenu={stopRowActivation ? (e) => e.stopPropagation() : undefined}
      className={cn(
        "min-w-0 bg-app text-[13px] font-medium text-ink",
        "border border-line outline-none ring-2 ring-brand/30 focus:border-brand",
        className,
      )}
    />
  );
}
