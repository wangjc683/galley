import { Check } from "@phosphor-icons/react";
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export type CheckboxSize = "sm" | "md";

/** How a ticked box is filled. TEMP variant switcher (main chat 83):
 * `quiet` is only the to-do panel's 已完成 and done to-do cards on B
 * and C (components/todo/todo-variants/todo-variants.ts); it stays if
 * one of them wins. */
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
  /** Ticked: `brand` (the default — every box but these) fills it with
   * the brand colour; `quiet` fills and edges it `line-strong` with an
   * `ink-soft` tick, for a thing done that asks nothing more. */
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
