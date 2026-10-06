import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Settings' two badge families (2026-10-07 cross-tab audit, D3). Pick by
 * what the chip says, not by how loud it should look:
 *
 * - `SettingsStatusBadge` — run-state: something is running, in
 *   progress, needs your hands, or is broken. Bordered, toned, always
 *   led by an icon. Geometry is the Channels StatusBadge's (24px tall).
 * - `SettingsTag` — a label, count, or designation (推荐 / 默认 / N 个模型
 *   / 无鉴权). No border, no icon; it names a fact, it doesn't report a
 *   state.
 *
 * Both sit at `text-ui-tertiary` (11.5px) on purpose: `text-ui-micro`
 * (10.5px) is reserved for Latin uppercase chips, and every badge here
 * can carry Han characters.
 */

export type SettingsStatusTone = "success" | "neutral" | "warning" | "error";

const STATUS_TONE_CLASS: Record<SettingsStatusTone, string> = {
  success: "border-success/30 bg-success/[var(--opacity-soft)] text-success",
  neutral: "border-line bg-surface text-ink-muted",
  warning: "border-warning/30 bg-warning/[var(--opacity-soft)] text-warning",
  error: "border-error/25 bg-error/[var(--opacity-subtle)] text-error",
};

export function SettingsStatusBadge({
  tone,
  icon: Icon,
  spin = false,
  role,
  title,
  className,
  children,
}: {
  tone: SettingsStatusTone;
  /** Leading Phosphor icon. Rendered at one size (12px); thin weight,
   * except the success check, which stays filled — fill marks the
   * active state (polish-checklist P11) and is the app-wide "done"
   * mark (probe results, the Channels running badge). */
  icon: PhosphorIcon;
  /** Spin the icon (in-flight states: starting, checking, preparing). */
  spin?: boolean;
  role?: string;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      role={role}
      title={title}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 text-ui-tertiary",
        STATUS_TONE_CLASS[tone],
        className,
      )}
    >
      <Icon
        size={12}
        weight={tone === "success" ? "fill" : "thin"}
        className={cn("shrink-0", spin && "spin")}
      />
      {children}
    </span>
  );
}

export type SettingsTagTone = "neutral" | "brand";

const TAG_TONE_CLASS: Record<SettingsTagTone, string> = {
  neutral: "bg-hover text-ink-muted",
  brand: "bg-brand-soft text-brand-strong",
};

export function SettingsTag({
  tone = "neutral",
  title,
  className,
  children,
}: {
  tone?: SettingsTagTone;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        // leading-4 pins the chip at 18px wherever it lands, instead of
        // inheriting whatever line-height the host row happens to set.
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-sm px-1.5 py-px text-ui-tertiary leading-4",
        TAG_TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
