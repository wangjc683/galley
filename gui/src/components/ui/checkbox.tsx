import { Check } from "@phosphor-icons/react";
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { useFlipBeat } from "@/hooks/useFlipBeat";
import { cn } from "@/lib/utils";

export type CheckboxSize = "sm" | "md";

/** How a ticked box is filled: `brand`, every box's; `quiet` only for a
 * to-do done in Core — the to-do panel's 已完成 and done to-do cards
 * (main chat ticket 84, PRD ruling 129 point 2: a thing done asks for
 * nothing, and brand is Galley at work or inviting you to start). A
 * to-do's tick in its 1.5 s hold stays brand. */
export type CheckboxCheckedTone = "brand" | "quiet";

export interface CheckboxProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "children" | "onChange" | "size" | "type"
  > {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: CheckboxSize;
  children?: ReactNode;
  /** Classes for the box's wrapper — e.g. a top margin that centers the
   * box on the first text line when the label is `items-start`
   * (multi-line labels), since a top-aligned box sits 1–2px high. */
  boxClassName?: string;
  /** Ticked: `brand` (the default) fills it with the brand colour;
   * `quiet` fills and edges it `line-strong` (each theme's own) with an
   * `ink-soft` tick — same shape, size and tick, still clickable. */
  checkedTone?: CheckboxCheckedTone;
}

const BOX_SIZE_CLASSES: Record<CheckboxSize, string> = {
  sm: "size-3.5",
  md: "size-4",
};

const ICON_SIZE: Record<CheckboxSize, number> = {
  sm: 10,
  md: 12,
};

const CHECKED_TONE_CLASSES: Record<CheckboxCheckedTone, string> = {
  brand: "border-brand bg-brand text-ink",
  quiet: "border-line-strong bg-line-strong text-ink-soft",
};

/**
 * Held down (main chat ticket 160, PRD ruling 208 point 2): a box not
 * disabled sinks to 0.9 while the pointer holds it or its label (the
 * label is the `group`) — foundations §2.5's key travel, a button's
 * rule: the transition lives on `:active` only, the box at rest has
 * none, so it snaps back to 1 on release. `scale`, not `transform`, in
 * the list (Tailwind v4's `scale-*` is its own property). Not under
 * reduced motion.
 */
const PRESS_CLASSES =
  "motion-safe:group-active:scale-90 group-active:transition-[scale] group-active:duration-(--motion-press) group-active:ease-firm";

/**
 * How long a tick's or an untick's classes stay on the box: the beat's
 * longest part, the pop's `--motion-slow` (240ms), plus margin. Not a
 * motion duration — the classes come off after it so nothing can replay
 * them (`useFlipBeat`) and hover is instant again (§2.5).
 */
const CHECKBOX_BEAT_CLEAR_MS = 400;

/**
 * The app's one checkbox: the to-do panel's and the to-do cards' boxes,
 * a to-do's items, and the archive and edit-project dialogs'.
 *
 * Its beat (main chat ticket 160, PRD ruling 208 point 2; foundations
 * §2.5), the same for every use, no switch: held down, it sinks
 * (`PRESS_CLASSES`). Ticked after mount, whoever ticked it, the fill and
 * edge ease into the ticked colours over `--motion-fast`, the tick is
 * uncovered from the left over `--motion-base`, and the box pops 1 →
 * 1.12 → 1 over `--motion-slow`, all three at once (`checkbox-tick`).
 * Unticked, the colours ease back, the tick goes at once, no pop
 * (`checkbox-untick`). A box that mounts ticked is still. Reduced
 * motion: no sink, pop or sweep; the colours still ease. At rest it is
 * as it was before ticket 160, pixel for pixel.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    {
      checked,
      onCheckedChange,
      size = "md",
      children,
      className,
      boxClassName,
      checkedTone = "brand",
      disabled,
      onClick,
      ...rest
    },
    ref,
  ) {
    // Ticked or unticked after mount, whoever did it: the box's beat
    // (globals.css `checkbox-tick` / `checkbox-untick`). A box that
    // mounts ticked is still.
    const beat = useFlipBeat(checked, CHECKBOX_BEAT_CLEAR_MS);
    return (
      <label
        className={cn(
          "group inline-flex select-none items-center gap-2",
          disabled && "cursor-not-allowed opacity-40",
          className,
        )}
      >
        <span className={cn("relative inline-flex shrink-0", boxClassName)}>
          <input
            ref={ref}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
            onClick={onClick}
            className="peer sr-only"
            {...rest}
          />
          <span
            aria-hidden
            className={cn(
              "inline-flex items-center justify-center rounded-sm border",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40",
              checked
                ? CHECKED_TONE_CLASSES[checkedTone]
                : "border-line-strong bg-elevated text-transparent",
              !disabled && !checked && "group-hover:border-brand",
              !disabled && PRESS_CLASSES,
              beat === "on" && "checkbox-tick",
              beat === "off" && "checkbox-untick",
              BOX_SIZE_CLASSES[size],
            )}
          >
            <Check size={ICON_SIZE[size]} weight="bold" />
          </span>
        </span>
        {children}
      </label>
    );
  },
);
