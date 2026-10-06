import {
  CheckCircle,
  CircleNotch,
  Pause,
  Power,
  QrCode,
  WarningCircle,
} from "@phosphor-icons/react";

import {
  SettingsStatusBadge,
  type SettingsStatusTone,
} from "@/components/screens/settings/settings-badges";
import { useCopy } from "@/lib/i18n";
import type { ImSupervisorState } from "@/lib/im-supervisor";

/**
 * Channel run-state → Settings status badge. Only the mapping lives here
 * (tone from `state`, icon from `iconStateOverride ?? state`); geometry,
 * tones and icon weight belong to `SettingsStatusBadge`.
 */
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
  const tone: SettingsStatusTone =
    state === "running"
      ? "success"
      : state === "error" || state === "expired"
        ? "error"
        : "neutral";
  return (
    <SettingsStatusBadge
      tone={tone}
      icon={Icon}
      spin={iconState === "starting" || iconState === "reconnecting"}
    >
      {label}
    </SettingsStatusBadge>
  );
}
