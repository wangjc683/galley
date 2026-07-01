import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SettingsPanelHeader({
  title,
  subtitle,
  wordmark = false,
}: {
  title: string;
  subtitle?: string;
  /** Larger brand heading for the About tab only. */
  wordmark?: boolean;
}) {
  return (
    <div>
      <h2
        className={cn(
          "m-0 text-ink",
          wordmark
            ? "font-serif text-[20px] font-semibold tracking-[0.005em]"
            : "text-[18px] font-semibold",
        )}
      >
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 text-ui-secondary text-ink-muted">{subtitle}</p>
      )}
    </div>
  );
}

export function SettingsSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-ui-label font-semibold uppercase tracking-[0.08em] text-ink-muted">
      {children}
    </div>
  );
}
