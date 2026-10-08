import type { ReactNode } from "react";

import { SettingsTag } from "@/components/screens/settings/settings-badges";
import { SettingsDisclosureRow } from "@/components/screens/settings/settings-disclosure";
import { useCopy } from "@/lib/i18n";
import type { RuntimeKind } from "@/types/session";

import { ExternalRuntimeCard } from "./ExternalRuntimeCard";

export function ExternalRuntimeAccess({
  expanded,
  value,
  gaPath,
  hasExternalRuntimeConfigured,
  hasRunningSessions,
  onToggleExpanded,
  onActivate,
  children,
}: {
  expanded: boolean;
  value: RuntimeKind;
  gaPath: string;
  hasExternalRuntimeConfigured: boolean;
  hasRunningSessions: boolean;
  onToggleExpanded: () => void;
  onActivate?: () => void;
  children: ReactNode;
}) {
  const copy = useCopy().settings.runtime;
  const active = value === "external";
  return (
    <SettingsDisclosureRow
      // Inactive, the row is an action ("接入外部 GA"); once external
      // is the runtime in use, it names the thing next to "正在使用".
      title={active ? copy.externalGA : copy.connectExternalGA}
      badge={active ? <SettingsTag>{copy.active}</SettingsTag> : undefined}
      open={expanded}
      onToggle={onToggleExpanded}
    >
      <div className="space-y-5">
        <ExternalRuntimeCard
          value={value}
          gaPath={gaPath}
          hasExternalRuntimeConfigured={hasExternalRuntimeConfigured}
          hasRunningSessions={hasRunningSessions}
          onActivate={onActivate}
        />
        {children}
      </div>
    </SettingsDisclosureRow>
  );
}
