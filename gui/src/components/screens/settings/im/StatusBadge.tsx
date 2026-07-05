import {
  CheckCircle,
  CircleNotch,
  Pause,
  Power,
  QrCode,
  WarningCircle,
} from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import type { ImSupervisorState } from "@/lib/im-supervisor";
import { cn } from "@/lib/utils";

export function StatusBadge({
  state,
  labelOverride,
  iconStateOverride,
}: {
  state: ImSupervisorState;
  labelOverride?: string;
  iconStateOverride?: ImSupervisorState;
}) {
  const imCopy = useCopy().settings.im;
  const iconState = iconStateOverride ?? state;
  const label =
    labelOverride ??
    {
      not_connected: imCopy.notConnected,
      starting: imCopy.starting,
      waiting_scan: imCopy.waitingScan,
      reconnecting: imCopy.reconnecting,
      running: imCopy.running,
      expired: imCopy.expired,
      error: imCopy.error,
      stopped: imCopy.stopped,
    }[state];
  const Icon =
    iconState === "running"
      ? CheckCircle
      : iconState === "error" || iconState === "expired"
        ? WarningCircle
        : iconState === "starting" || iconState === "reconnecting"
          ? CircleNotch
          : iconState === "waiting_scan"
            ? QrCode
            : iconState === "stopped"
              ? Pause
              : Power;
  return (
    <span
      className={cn(
        // Chip metrics sit a tier below the 13px card title: CJK labels
        // (未接入 / 运行中) at ui-tertiary read almost title-sized, so
        // the badge uses ui-micro with proportionally tighter box.
        "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-ui-micro",
        state === "running"
          ? "border-success/30 bg-success/[var(--opacity-soft)] text-success"
          : state === "error" || state === "expired"
            ? "border-error/25 bg-error/[var(--opacity-subtle)] text-error"
            : "border-line bg-surface text-ink-muted",
      )}
    >
      <Icon
        size={11}
        weight={iconState === "running" ? "fill" : "regular"}
        className={
          iconState === "starting" || iconState === "reconnecting"
            ? "animate-spin"
            : undefined
        }
      />
      {label}
    </span>
  );
}
