import {
  CheckCircle,
  CircleNotch,
  Pause,
  Power,
  QrCode,
  WarningCircle,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import { SettingsStatusBadge } from "@/components/screens/settings/settings-badges";
import { useCopy } from "@/lib/i18n";

import {
  channelBadgeLabel,
  channelBadgeTone,
  type ChannelBadgeKind,
} from "./channel-view";

const BADGE_ICON: Record<ChannelBadgeKind, PhosphorIcon> = {
  not_connected: Power,
  not_started: Power,
  starting: CircleNotch,
  waiting_scan: QrCode,
  reconnecting: CircleNotch,
  connected: CheckCircle,
  service_started: CheckCircle,
  paused: Pause,
  expired: WarningCircle,
  error: WarningCircle,
};

/**
 * Channel run-state → Settings status badge. The word and tone come from
 * `channel-view.ts` (shared with the topbar Channels menu); only the icon
 * lives here. Geometry, tones and icon weight belong to
 * `SettingsStatusBadge`.
 */
export function StatusBadge({ kind }: { kind: ChannelBadgeKind }) {
  const imCopy = useCopy().settings.im;
  return (
    <SettingsStatusBadge
      tone={channelBadgeTone(kind)}
      icon={BADGE_ICON[kind]}
      spin={kind === "starting" || kind === "reconnecting"}
    >
      {channelBadgeLabel(kind, imCopy)}
    </SettingsStatusBadge>
  );
}
