import { SettingsNavRow } from "@/components/screens/settings/settings-disclosure";
import { useCopy } from "@/lib/i18n";

export function SetupAssistantAccess({
  hasRunningSessions,
  onOpenSetupAssistant,
}: {
  hasRunningSessions: boolean;
  onOpenSetupAssistant?: () => void;
}) {
  const copy = useCopy().settings.runtime;
  const disabled = hasRunningSessions || !onOpenSetupAssistant;
  return (
    <SettingsNavRow
      title={copy.setupAssistant}
      subtitle={
        hasRunningSessions
          ? copy.setupAssistantRunningBlock
          : copy.setupAssistantDescription
      }
      disabled={disabled}
      onOpen={onOpenSetupAssistant}
    />
  );
}
