import { Info, WarningCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The reading panel's status vocabulary — one place for loading, info,
 * error and empty states so Markdown preview and Git review render them
 * identically. `error` and `info` borrow the settings pages' inline
 * line grammar (ErrorLine / InfoLine); `empty` is a centred terminal
 * state with an icon, the shape the palette and provider pickers use
 * for "nothing here, and that is fine".
 */
export function PanelNotice({
  kind,
  icon,
  children,
  className,
}: {
  kind: "loading" | "info" | "error" | "empty";
  /** Optional glyph for `empty`. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  if (kind === "empty") {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-ui-secondary text-ink-muted",
          className,
        )}
      >
        {icon && <span className="text-ink-muted/70">{icon}</span>}
        <p className="max-w-[36ch] leading-secondary">{children}</p>
      </div>
    );
  }
  if (kind === "loading") {
    return (
      <p
        role="status"
        className={cn("px-4 py-3 text-ui-secondary text-ink-muted", className)}
      >
        {children}
      </p>
    );
  }
  const error = kind === "error";
  return (
    <div className={cn("px-4 py-3", className)}>
      <div
        role={error ? "alert" : undefined}
        className={cn(
          "flex select-text items-start gap-1.5 rounded-sm border px-3 py-2 text-ui-secondary leading-dense",
          error
            ? "border-error/20 bg-error/[var(--opacity-subtle)] text-error"
            : "border-line bg-elevated/55 text-ink-soft",
        )}
      >
        {error ? (
          <WarningCircle size={12} weight="fill" className="mt-0.5 shrink-0" />
        ) : (
          <Info size={12} weight="bold" className="mt-0.5 shrink-0 text-ink-muted" />
        )}
        <span>{children}</span>
      </div>
    </div>
  );
}
