import type { HTMLAttributes, ReactNode } from "react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SegmentedControlSize = "sm" | "md";

export interface SegmentedControlOption<TValue extends string> {
  value: TValue;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<TValue extends string>
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: TValue;
  options: readonly SegmentedControlOption<TValue>[];
  onValueChange?: (value: TValue) => void;
  ariaLabel: string;
  size?: SegmentedControlSize;
}

const ITEM_SIZE_CLASSES: Record<SegmentedControlSize, string> = {
  sm: "h-6 gap-1 px-2 text-[12px]",
  md: "h-7 gap-1.5 px-2.5 text-[12.5px]",
};

export function SegmentedControl<TValue extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  size = "md",
  className,
  ...rest
}: SegmentedControlProps<TValue>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        // Track uses bg-hover, not bg-surface: the active thumb is
        // bg-elevated, and surface/elevated are near-identical whites in
        // light mode — on an elevated parent (e.g. a popover) the
        // selection became unreadable. The darker track restores the
        // thumb-on-track contrast on every parent background.
        "inline-flex items-center rounded-sm border border-line bg-hover p-0.5",
        className,
      )}
      {...rest}
    >
      {options.map((option) => {
        const active = option.value === value;
        const button = (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => {
              if (!option.disabled && !active) onValueChange?.(option.value);
            }}
            className={cn(
              "inline-flex select-none items-center justify-center rounded-sm transition-colors",
              // ring-inset, not an outer ring: the track is only p-0.5, so
              // an outer ring on an edge segment collided with the track
              // border / spilled into the neighbor and read as clipped.
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40",
              "disabled:cursor-not-allowed disabled:opacity-40",
              ITEM_SIZE_CLASSES[size],
              active
                ? "bg-elevated font-medium text-brand-strong shadow-card"
                : "text-ink-soft hover:text-ink",
            )}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        );
        if (!option.title) return button;
        return (
          <TooltipLabel key={option.value} text={option.title}>
            {button}
          </TooltipLabel>
        );
      })}
    </div>
  );
}
