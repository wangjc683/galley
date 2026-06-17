import { type ReactNode } from "react";

import { SettingsSectionLabel } from "@/components/screens/settings/settings-ui";
import { useCopy } from "@/lib/i18n";
import type { RuntimeKind } from "@/types/session";

import { ExternalRuntimeAccess } from "./ExternalRuntimeAccess";
import { SetupAssistantAccess } from "./SetupAssistantAccess";

export function AdvancedRuntimeSettings({
  expanded,
  value,
  hasExternalRuntimeConfigured,
  hasRunningSessions,
  highlighted,
  nativeRuntimeSlot,
  managedDiagnosticsSlot,
  onOpenSetupAssistant,
  onToggleExpanded,
  onActivate,
  children,
}: {
  expanded: boolean;
  value: RuntimeKind;
  hasExternalRuntimeConfigured: boolean;
  hasRunningSessions: boolean;
  highlighted: boolean;
  nativeRuntimeSlot?: ReactNode;
  managedDiagnosticsSlot?: ReactNode;
  onOpenSetupAssistant?: () => void;
  onToggleExpanded: () => void;
  onActivate?: () => void;
  children: ReactNode;
}) {
  const copy = useCopy().settings.runtime;
  return (
    <div>
      <SettingsSectionLabel>{copy.more}</SettingsSectionLabel>
      <div className="mt-2 divide-y divide-line overflow-hidden rounded-sm border border-line bg-surface">
        <SetupAssistantAccess
          hasRunningSessions={hasRunningSessions}
          onOpenSetupAssistant={onOpenSetupAssistant}
        />

        <ExternalRuntimeAccess
          expanded={expanded}
          value={value}
          hasExternalRuntimeConfigured={hasExternalRuntimeConfigured}
          hasRunningSessions={hasRunningSessions}
          highlighted={highlighted}
          onToggleExpanded={onToggleExpanded}
          onActivate={onActivate}
        >
          {children}
        </ExternalRuntimeAccess>

        {nativeRuntimeSlot}

        {managedDiagnosticsSlot}
      </div>
    </div>
  );
}
