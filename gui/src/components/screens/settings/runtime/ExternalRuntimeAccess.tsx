import type { ReactNode } from "react";

import { SettingsTag } from "@/components/screens/settings/settings-badges";
import { SettingsDisclosureRow } from "@/components/screens/settings/settings-disclosure";
import { useCopy } from "@/lib/i18n";
import type { RuntimeKind } from "@/types/session";

import { ExternalRuntimeCard } from "./ExternalRuntimeCard";

export function ExternalRuntimeAccess({
  expanded,
  value,
  hasExternalRuntimeConfigured,
  hasRunningSessions,
  onToggleExpanded,
  onActivate,
  children,
}: {
  expanded: boolean;
  value: RuntimeKind;
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
      title={copy.connectExternalGA}
      badge={active ? <SettingsTag>{copy.active}</SettingsTag> : undefined}
      open={expanded}
      onToggle={onToggleExpanded}
    >
      <div className="space-y-5">
        <ExternalRuntimeCard
          value={value}
          hasExternalRuntimeConfigured={hasExternalRuntimeConfigured}
          hasRunningSessions={hasRunningSessions}
          onActivate={onActivate}
        />
        {children}
      </div>
    </SettingsDisclosureRow>
  );
}
