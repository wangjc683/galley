import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared 28px icon button for the column headers — MainHeader's utility
 * cluster (Changes / 显示 / Supervisor SOP / settings), its
 * icon-form status indicators (engine / the Browser Control and Channels
 * lamps), and SidebarHeader's 搜索 / 定时 / 项目. One place owns the
 * hover / press / popover-open rhythm so a motion tweak can't drift
 * across the call sites.
 *
 * The open-state styles key off `aria-expanded="true"`, which Radix
 * popover / menu triggers set while open; plain toggle buttons never
 * carry it. Not `data-state="open"` alone: every topbar trigger sits
 * inside a `TooltipLabel`, and the Tooltip trigger's own data-state
 * ("closed" / "delayed-open" / "instant-open") is merged over the
 * popover's, so the open press never showed (found 2026-10-04). The
 * data-state variant stays for a trigger without a tooltip.
 *
 * Appearance preferences (the 显示 popover's width / font size / theme)
 * intentionally get NO persistent "non-default" tint: a settled
 * preference is not actionable information, and a permanently tinted
 * button is standing noise in a quiet workbench. Current state lives
 * inside the popover.
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
        "aria-expanded:translate-y-px aria-expanded:border-line aria-expanded:bg-hover aria-expanded:text-ink aria-expanded:shadow-[var(--shadow-control-press)]",
        className,
      )}
      {...rest}
    />
  );
});
