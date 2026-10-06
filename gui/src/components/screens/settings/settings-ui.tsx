import type { ReactNode } from "react";

import { useLanguage } from "@/lib/i18n";
import { isChineseLanguage } from "@/lib/language";
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
  // Uppercase + letter-spacing is an English-UI eyebrow treatment only
  // (2026-10-07). In the Chinese UI it does nothing for Han characters
  // except spread them apart, and it forces embedded Latin words into
  // caps (「将随 Bug 报告附上」 rendered as "BUG").
  const latinEyebrow = !isChineseLanguage(useLanguage());
  return (
    // tabular-nums: keeps digits even if a label ever interpolates a
    // live count.
    <div
      className={cn(
        "text-ui-label font-semibold tabular-nums text-ink-muted",
        latinEyebrow && "uppercase tracking-[0.08em]",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Field-level label for content nested inside a section (accordion
 * bodies, expanded rows). Deliberately one tier below
 * SettingsSectionLabel — no uppercase, no tracking — so expanding an
 * advanced row never re-introduces page-level eyebrows and flattens
 * the hierarchy.
 */
export function SettingsFieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-ui-meta font-medium text-ink-soft">{children}</div>
  );
}
