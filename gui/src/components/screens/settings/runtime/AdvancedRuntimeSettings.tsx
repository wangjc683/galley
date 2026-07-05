import { type ReactNode } from "react";

import { SettingsSectionLabel } from "@/components/screens/settings/settings-ui";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { RuntimeKind } from "@/types/session";

import { ExternalRuntimeAccess } from "./ExternalRuntimeAccess";
import { SetupAssistantAccess } from "./SetupAssistantAccess";

export function AdvancedRuntimeSettings({
  expanded,
  value,
  hasExternalRuntimeConfigured,
  hasRunningSessions,
  highlighted,
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
      <div
        className={cn(
          "mt-2 divide-y divide-line overflow-hidden rounded-sm border border-line bg-surface",
          // The activation pulse targets this bordered container (the
          // row headers have no border of their own and overflow-hidden
          // would clip a row-level shadow), so the acknowledgement
          // lands on the group where the external runtime lives.
          highlighted && "runtime-mode-highlight",
        )}
      >
        <SetupAssistantAccess
          hasRunningSessions={hasRunningSessions}
          onOpenSetupAssistant={onOpenSetupAssistant}
        />

        <ExternalRuntimeAccess
          expanded={expanded}
          value={value}
          hasExternalRuntimeConfigured={hasExternalRuntimeConfigured}
          hasRunningSessions={hasRunningSessions}
          onToggleExpanded={onToggleExpanded}
          onActivate={onActivate}
        >
          {children}
        </ExternalRuntimeAccess>

        {managedDiagnosticsSlot}
      </div>
    </div>
  );
}
