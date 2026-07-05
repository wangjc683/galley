import { ArrowsClockwise } from "@phosphor-icons/react";

import { SettingsFieldLabel } from "@/components/screens/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";

export function HealthCheckSection({
  onReRunHealthCheck,
}: {
  onReRunHealthCheck?: () => void;
}) {
  const copy = useCopy().settings.runtime;
  return (
    <div>
      <SettingsFieldLabel>Health Check</SettingsFieldLabel>
      <p className="mt-1.5 text-ui-meta leading-[1.55] text-ink-muted">
        {copy.healthDescription}
      </p>
      <Button
        variant="accent-secondary"
        size="sm"
        disabled={!onReRunHealthCheck}
        onClick={onReRunHealthCheck}
        className="mt-2.5"
        leadingIcon={<ArrowsClockwise size={12} weight="thin" />}
      >
        {copy.runHealthCheck}
      </Button>
    </div>
  );
}
