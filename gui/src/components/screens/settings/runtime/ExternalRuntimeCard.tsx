import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import type { RuntimeKind } from "@/types/session";

/**
 * Status + switch action for the external runtime, rendered as the
 * first line inside the "接入外部 GA" accordion. The accordion header
 * already names the concept (and carries the "正在使用" badge when
 * external is active), so this row never repeats the icon/title —
 * when active it renders nothing at all.
 */
export function ExternalRuntimeCard({
  value,
  hasExternalRuntimeConfigured,
  hasRunningSessions,
  onActivate,
}: {
  value: RuntimeKind;
  hasExternalRuntimeConfigured: boolean;
  hasRunningSessions: boolean;
  onActivate?: () => void;
}) {
  const copy = useCopy().settings.runtime;
  const active = value === "external";
  if (active) return null;
  const canActivate =
    hasExternalRuntimeConfigured && !hasRunningSessions && !!onActivate;
  const detail = hasExternalRuntimeConfigured
    ? copy.externalReady
    : copy.needsGAPath;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-ui-secondary text-ink-soft">
          {detail}
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!canActivate}
          onClick={onActivate}
        >
          {copy.switchToExternalGA}
        </Button>
      </div>
      {hasRunningSessions && (
        <div className="mt-2 text-ui-tertiary text-ink-muted">
          {copy.runningSessionsBlock}
        </div>
      )}
    </div>
  );
}
