import type { ReactNode } from "react";

import { useLanguage } from "@/lib/i18n";
import { isChineseLanguage } from "@/lib/language";
import { cn } from "@/lib/utils";

/**
 * Labelled field row for form dialogs (project create / edit, scheduled
 * tasks). Uppercase + letter-spacing is an English-UI eyebrow treatment
 * only, same rule as Settings' SettingsSectionLabel (2026-10-07): in the
 * Chinese UI it just spreads Han characters apart.
 */
export function DialogField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  const latinEyebrow = !isChineseLanguage(useLanguage());
  return (
    <div>
      <label
        className={cn(
          "block text-ui-label font-semibold text-ink-muted",
          latinEyebrow && "uppercase tracking-[0.08em]",
        )}
      >
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
