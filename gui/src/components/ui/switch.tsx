import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export type SwitchSize = "sm" | "md";
export type SwitchTone = "brand" | "warning";

export interface SwitchProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "aria-checked" | "aria-label" | "onChange"
  > {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  ariaLabel: string;
  size?: SwitchSize;
  tone?: SwitchTone;
}

const SWITCH_SIZE_CLASSES: Record<SwitchSize, string> = {
  sm: "h-4 w-7",
  md: "h-5 w-9",
};

const KNOB_SIZE_CLASSES: Record<SwitchSize, string> = {
  sm: "size-3 translate-x-0.5 data-[checked=true]:translate-x-3.5",
  md: "size-4 translate-x-0.5 data-[checked=true]:translate-x-[18px]",
};

const CHECKED_TONE_CLASSES: Record<SwitchTone, string> = {
  brand: "bg-brand",
  warning: "bg-warning",
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    {
      checked,
      onCheckedChange,
      ariaLabel,
      size = "md",
      tone = "brand",
      disabled,
      className,
      type = "button",
      onClick,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        data-checked={checked}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || disabled) return;
          onCheckedChange?.(!checked);
        }}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-(--motion-fast) ease-firm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
          "disabled:cursor-not-allowed disabled:opacity-40",
          checked ? CHECKED_TONE_CLASSES[tone] : "bg-line-strong",
          SWITCH_SIZE_CLASSES[size],
          className,
        )}
        {...rest}
      >
        <span
          data-checked={checked}
          className={cn(
            "rounded-full bg-elevated shadow-card transition-transform duration-(--motion-fast) ease-firm",
            KNOB_SIZE_CLASSES[size],
          )}
        />
      </button>
    );
  },
);
