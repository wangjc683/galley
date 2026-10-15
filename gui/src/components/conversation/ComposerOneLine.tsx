import type { ReactNode, RefObject } from "react";

import { cn } from "@/lib/utils";

/**
 * A session's composer: one row of ＋, the input, 「模型 · 强度」 and
 * send / stop, the way IM apps draw it (main chat PRD rulings 71, 72; the
 * workbench's sessions too since ruling 74, the new-chat empty state
 * keeps the card).
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ ＋  发消息…                     gpt-6.1-sol · 默认   (↑)  │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The Composer hands over its pieces; this only arranges them. The box
 * is the card's (ground, border, shadow, apricot focus ring) with a 24px
 * radius: half the one-line height, and concentric with the round ＋ and
 * send 8px in from its edge (7px padding + the 1px border), so the row's
 * ends read as one shape. As the input grows the buttons stay at the
 * bottom (items-end), level with its last line. The image tiles sit
 * above the input, inside the box. The workbench's hint row sits under
 * the box, inset to the input's text (the Composer renders it; the main
 * chat has none). Measures: `ONE_LINE_*` in composer-styles.ts.
 *
 * The model phrase takes at most 40% of the row: past that the model
 * name truncates (the tier, the dot and send never shrink), so a long
 * name in a small window cannot squeeze the input or push send out.
 */
export function ComposerOneLine({
  rootRef,
  disabled,
  dropOverlay,
  imageStrip,
  addMenu,
  input,
  modelPhrase,
  actionSlot,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
  dropOverlay: ReactNode;
  imageStrip: ReactNode;
  addMenu: ReactNode;
  /** The ghost suggestion (and its screen-reader text) and the textarea. */
  input: ReactNode;
  modelPhrase: ReactNode;
  actionSlot: ReactNode;
}) {
  return (
    <div
      ref={rootRef}
      data-role="composer-one-line"
      className={cn(
        "relative rounded-[24px] border border-line bg-elevated p-[7px] shadow-card transition-[border-color,box-shadow,background-color] duration-(--motion-fast) ease-firm",
        "focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/20",
        disabled && "opacity-60",
      )}
    >
      {dropOverlay}
      {imageStrip}
      <div className="flex items-end gap-1">
        {addMenu}
        <div className="relative min-w-0 flex-1">{input}</div>
        <div className="flex h-8 min-w-0 max-w-[40%] items-center">
          {modelPhrase}
        </div>
        {actionSlot}
      </div>
    </div>
  );
}
