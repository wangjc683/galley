import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { IconTooltip, type TooltipSide } from "@/components/ui/tooltip";
import { blurAfterClick, preventMouseFocus } from "@/lib/pointer-focus";

/**
 * Canonical button surface for Galley. Every new button should use
 * this component; existing buttons migrate organically as their
 * containing files are touched.
 *
 * Why a component instead of a class string constant: variant +
 * size combinations multiply quickly, and inlining the cn() calls
 * everywhere makes per-button drift inevitable. A component
 * concentrates the source of truth and provides a typed prop API.
 *
 * ## Variants
 *
 *   primary — Main CTA. Charcoal foreground (`bg-ink`), elevated text.
 *             Used for "确认 / 保存 / 创建 / 继续". One per dialog
 *             or screen; the eye should know where to land. It has
 *             the strongest physical press response.
 *
 *   secondary — Border-only, neutral bg. Used for "取消 / Back / 次要
 *               操作". Pairs with a primary on the same row.
 *
 *   ghost — No border, no bg. Hover surfaces a subtle bg tint.
 *           Used for inline links / navigation aids ("Back" without
 *           a primary on the row, "Settings 中查看" tertiary links).
 *
 *   brand-soft — Brand-accented secondary action. Useful when the
 *                operation should be visually warmer than neutral
 *                secondary, but is not the primary action.
 *
 *   accent-secondary — Neutral readable label + brand-accent icon/hover.
 *                      Used for utility actions that need to be easy to
 *                      scan in dense settings panels ("检查更新" /
 *                      "选择" / "跑一次 Health Check").
 *
 *   warning — Amber filled. Used for high-attention but not destructive
 *             actions, such as "Stop" / YOLO confirmation.
 *
 *   destructive — Red filled. Reserved for irreversible actions
 *                 ("彻底删除"). Use sparingly — its color cost is
 *                 the warning signal.
 *
 *   destructive-soft — Pale-red bg + red text. For "this opens a
 *                      destructive flow" entry buttons (e.g., the
 *                      "删除项目" button inside EditProjectDialog
 *                      that opens ConfirmDeleteProjectDialog).
 *                      Less alarming than `destructive`, still
 *                      distinct from `secondary`.
 *
 * ## Sizes
 *
 *   sm — `px-2.5 py-1 / 12px` — Inline pill-density actions.
 *   md — `px-3.5 py-1.5 / 12.5px` — Standard dialog buttons.
 *        **Default.**
 *   lg — `px-5 py-2 / 13.5px` — Onboarding / hero CTAs.
 *
 * ## Notes
 *
 *   - Disabled handling is universal: `opacity-40 + cursor-not-allowed`.
 *     We don't `disabled:hover:*` override — opacity already kills the
 *     hover visual cleanly.
 *   - Button-like controls feel pressable with real key travel: hover
 *     rises a crisp 1px (firm shadow, planted — not floaty), press sinks
 *     2px with a slight compression scale and a deep contact inset
 *     (`--shadow-control-press`). Ghost / text-adjacent actions stay flat
 *     (a quiet 1px press, no shadow).
 *   - Hover is INSTANT (native desktop convention, §2.5/§2.7): the base
 *     has no transition, so hover color/lift/shadow flip immediately.
 *     Only the press animates — the transition lives on `:active` alone,
 *     so key travel sinks over `--motion-press` and release snaps back
 *     natively.
 *   - All variants use `rounded-sm` and shared motion timing. Override
 *     via `className` only when you have a specific reason (the
 *     ModeCard / Composer submit-pill remain hand-rolled outliers).
 *   - Icons (leadingIcon / trailingIcon) inherit the gap defined by
 *     the size. Caller is responsible for icon sizing + weight to
 *     match the button text. The icon side's padding runs 2px tighter
 *     than the text side (optical alignment — polish-checklist P2).
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "brand-soft"
  | "accent-secondary"
  | "warning"
  | "destructive"
  | "destructive-soft";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon node rendered before children. Sized + weighted by caller. */
  leadingIcon?: ReactNode;
  /** Icon node rendered after children. */
  trailingIcon?: ReactNode;
}

export type IconButtonVariant =
  | "ghost"
  | "secondary"
  | "brand"
  | "warning"
  | "danger";

export type IconButtonSize = "xs" | "sm" | "md";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label"
> {
  /** Accessible name. Icon-only buttons must not rely on visual icon meaning. */
  ariaLabel: string;
  /** Fast Radix tooltip text. Defaults to `title ?? ariaLabel`; `false` disables it. */
  tooltip?: string | false;
  tooltipSide?: TooltipSide;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  active?: boolean;
}

export interface DialogActionRowProps extends HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end" | "between";
}

const RAISED_BUTTON_SURFACE = cn(
  "shadow-[var(--shadow-button-raised)]",
  "hover:-translate-y-px hover:shadow-[var(--shadow-button-raised-hover)]",
  "active:translate-y-[2px] active:scale-[0.97] active:shadow-[var(--shadow-control-press)]",
  "disabled:translate-y-0 disabled:scale-100 disabled:shadow-none",
);

const QUIET_BUTTON_PRESS = cn(
  "active:translate-y-px",
  "disabled:translate-y-0 disabled:shadow-none",
);

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: cn(
    "border border-ink bg-ink font-medium text-elevated",
    "shadow-[var(--shadow-button-primary)]",
    "hover:-translate-y-px hover:bg-ink-hover hover:shadow-[var(--shadow-button-primary-hover)]",
    "active:translate-y-[2px] active:scale-[0.97] active:bg-ink active:shadow-[var(--shadow-control-press)]",
    "disabled:translate-y-0 disabled:scale-100 disabled:shadow-none",
  ),
  secondary: cn(
    "border border-line bg-elevated text-ink",
    "hover:bg-hover",
    RAISED_BUTTON_SURFACE,
  ),
  ghost: cn(
    "border border-transparent text-ink-soft",
    "hover:bg-hover hover:text-ink active:bg-selected/70",
    QUIET_BUTTON_PRESS,
  ),
  "brand-soft": cn(
    "border border-line bg-elevated font-medium text-brand-strong",
    "hover:border-brand hover:bg-brand-soft hover:text-ink",
    RAISED_BUTTON_SURFACE,
  ),
  "accent-secondary": cn(
    "border border-line bg-elevated font-medium text-ink",
    "hover:border-brand/[var(--opacity-strong)] hover:bg-brand-soft",
    "[&>svg]:text-brand-strong",
    RAISED_BUTTON_SURFACE,
  ),
  warning: cn(
    "border border-warning bg-warning font-medium text-elevated",
    "hover:bg-warning-hover",
    RAISED_BUTTON_SURFACE,
  ),
  destructive: cn(
    "border border-error bg-error font-medium text-elevated",
    "hover:bg-error-hover",
    RAISED_BUTTON_SURFACE,
  ),
  "destructive-soft": cn(
    "border border-error/30 bg-error/[var(--opacity-subtle)] font-medium text-error",
    "hover:bg-error/[var(--opacity-soft)]",
    RAISED_BUTTON_SURFACE,
  ),
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "gap-1 px-2.5 py-1 text-[12px]",
  md: "gap-1.5 px-3.5 py-1.5 text-[12.5px]",
  lg: "gap-2 px-5 py-2 text-[13.5px]",
};

// An icon carries ~2px of built-in air that text doesn't, so equal
// padding reads as the icon floating too far inboard. Each map is the
// size's padding minus 2px, applied only on the side that has an icon
// (polish-checklist P2).
const LEADING_ICON_PAD: Record<ButtonSize, string> = {
  sm: "pl-2",
  md: "pl-3",
  lg: "pl-4.5",
};
const TRAILING_ICON_PAD: Record<ButtonSize, string> = {
  sm: "pr-2",
  md: "pr-3",
  lg: "pr-4.5",
};

const ICON_VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost: cn(
    "border border-transparent text-ink-soft",
    "hover:bg-hover hover:text-ink active:bg-selected/70",
    QUIET_BUTTON_PRESS,
  ),
  secondary: cn(
    "border border-line bg-elevated text-ink-soft",
    "hover:bg-hover hover:text-ink",
    RAISED_BUTTON_SURFACE,
  ),
  brand: cn(
    "border border-brand/30 bg-brand/[var(--opacity-soft)] text-brand-strong",
    "hover:bg-brand-soft hover:text-ink",
    RAISED_BUTTON_SURFACE,
  ),
  warning: cn(
    "border border-warning/30 bg-warning/[var(--opacity-soft)] text-warning",
    "hover:bg-warning/[var(--opacity-medium)]",
    RAISED_BUTTON_SURFACE,
  ),
  danger: cn(
    "border border-transparent text-ink-soft",
    "hover:bg-error/[var(--opacity-soft)] hover:text-error active:bg-error/[var(--opacity-medium)]",
    QUIET_BUTTON_PRESS,
  ),
};

const ICON_ACTIVE_CLASSES: Record<IconButtonVariant, string> = {
  ghost: "bg-hover text-ink",
  secondary: "bg-hover text-ink",
  brand: "bg-brand-soft text-brand-strong",
  warning: "bg-warning/[var(--opacity-medium)] text-warning",
  danger: "bg-error/[var(--opacity-soft)] text-error",
};

const ICON_SIZE_CLASSES: Record<IconButtonSize, string> = {
  xs: "size-5",
  sm: "size-7",
  md: "size-8",
};

const DIALOG_ACTION_ALIGN_CLASSES: Record<
  NonNullable<DialogActionRowProps["align"]>,
  string
> = {
  start: "justify-start",
  end: "justify-end",
  between: "justify-between",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      leadingIcon,
      trailingIcon,
      className,
      children,
      type = "button",
      onClick,
      onMouseDown,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex select-none items-center justify-center rounded-sm",
          "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
          "outline-none disabled:cursor-not-allowed disabled:opacity-40",
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          leadingIcon != null && LEADING_ICON_PAD[size],
          trailingIcon != null && TRAILING_ICON_PAD[size],
          className,
        )}
        onMouseDown={(event) => {
          onMouseDown?.(event);
          preventMouseFocus(event);
        }}
        onClick={(event) => {
          onClick?.(event);
          blurAfterClick(event);
        }}
        {...rest}
      >
        {leadingIcon}
        {children}
        {trailingIcon}
      </button>
    );
  },
);

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      ariaLabel,
      variant = "ghost",
      size = "sm",
      active = false,
      className,
      children,
      type = "button",
      tooltip,
      tooltipSide,
      title,
      onClick,
      onMouseDown,
      ...rest
    },
    ref,
  ) {
    const button = (
      <button
        ref={ref}
        type={type}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex select-none items-center justify-center rounded-sm",
          "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
          "outline-none disabled:cursor-not-allowed disabled:opacity-40",
          ICON_VARIANT_CLASSES[variant],
          ICON_SIZE_CLASSES[size],
          active && ICON_ACTIVE_CLASSES[variant],
          className,
        )}
        onMouseDown={(event) => {
          onMouseDown?.(event);
          preventMouseFocus(event);
        }}
        onClick={(event) => {
          onClick?.(event);
          blurAfterClick(event);
        }}
        {...rest}
      >
        {children}
      </button>
    );
    const tooltipText =
      tooltip === false ? null : (tooltip ?? title ?? ariaLabel);
    if (!tooltipText) return button;
    return (
      <IconTooltip text={tooltipText} side={tooltipSide}>
        {button}
      </IconTooltip>
    );
  },
);

export function DialogActionRow({
  align = "end",
  className,
  children,
  ...rest
}: DialogActionRowProps) {
  return (
    <div
      className={cn(
        "mt-5 flex items-center gap-2",
        DIALOG_ACTION_ALIGN_CLASSES[align],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
