import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared 28px icon button for MainHeader controls — the utility cluster
 * (width / font size / theme / settings) and the icon-form status
 * indicators (Browser Control / Channels). One place owns the hover /
 * press / popover-open rhythm so a motion tweak can't drift across the
 * call sites.
 *
 * The open-state styles key off Radix's `data-state="open"` and apply
 * to popover/menu triggers automatically; plain toggle buttons never
 * carry that attribute, so including them here is harmless. (Radix
 * Tooltip also sets data-state on the same element, but its values are
 * "closed" / "delayed-open" / "instant-open" — never "open".)
 *
 * Appearance preferences (width / font size / theme) intentionally get
 * NO persistent "non-default" tint: a settled preference is not
 * actionable information, and a permanently tinted button is standing
 * noise in a quiet workbench. Current state lives in the tooltip and
 * inside the control's popover.
 */
export const TopBarIconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function TopBarIconButton({ className, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md border border-transparent text-ink-muted",
        "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
        "hover:border-line hover:bg-hover hover:text-ink",
        "active:translate-y-px",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        "data-[state=open]:translate-y-px data-[state=open]:border-line data-[state=open]:bg-hover data-[state=open]:text-ink data-[state=open]:shadow-[var(--shadow-control-press)]",
        className,
      )}
      {...rest}
    />
  );
});
