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
        "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-[11.5px]",
        state === "running"
          ? "border-success/30 bg-success/[var(--opacity-soft)] text-success"
          : state === "error" || state === "expired"
            ? "border-error/25 bg-error/[var(--opacity-subtle)] text-error"
            : "border-line bg-surface text-ink-muted",
      )}
    >
      <Icon
        size={12}
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
