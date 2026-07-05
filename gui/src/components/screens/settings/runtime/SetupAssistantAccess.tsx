import { useCopy } from "@/lib/i18n";

import { RuntimeNavRow } from "./RuntimeAccordionRow";

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
    <RuntimeNavRow
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
