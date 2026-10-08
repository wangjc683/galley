import { useEffect, useState } from "react";

import type { PathValidation } from "@/components/screens/onboarding/StepAttach";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { validateGAPath } from "@/lib/onboarding-validation";
import { cn } from "@/lib/utils";
import type { RuntimeKind } from "@/types/session";

/**
 * Status + switch action for the external runtime, rendered as the
 * first line inside the "接入外部 GA" accordion. The accordion header
 * already names the concept (and carries the "正在使用" badge when
 * external is active), so this row never repeats the icon/title —
 * when active it renders nothing at all.
 *
 * "外部 GA 已可用" is backed by a read-only check of the saved folder
 * (`validateGAPath`), run each time the accordion opens and whenever
 * the saved path changes. Until it answers, the line says the neutral
 * "已设置路径" — never "available" first and then a correction. A
 * folder that no longer exists turns the line into a warning and
 * disables the switch; a folder without agentmain.py stays neutral
 * (the path field already warns about it, and Health Check is the
 * authority on whether that checkout runs).
 */
export function ExternalRuntimeCard({
  value,
  gaPath,
  hasExternalRuntimeConfigured,
  hasRunningSessions,
  onActivate,
}: {
  value: RuntimeKind;
  gaPath: string;
  hasExternalRuntimeConfigured: boolean;
  hasRunningSessions: boolean;
  onActivate?: () => void;
}) {
  const copy = useCopy().settings.runtime;
  const active = value === "external";
  const path = gaPath.trim();
  // Keyed by the path it answers for, so a newly saved path reads as
  // "not checked yet" without resetting state synchronously.
  const [checked, setChecked] = useState<{
    path: string;
    result: PathValidation;
  } | null>(null);

  useEffect(() => {
    if (active || !hasExternalRuntimeConfigured || path === "") return;
    let cancelled = false;
    void validateGAPath(path)
      .catch(() => null)
      .then((result) => {
        if (!cancelled) setChecked({ path, result });
      });
    return () => {
      cancelled = true;
    };
  }, [active, hasExternalRuntimeConfigured, path]);

  if (active) return null;
  const validation = checked?.path === path ? checked.result : null;
  const pathMissing = validation?.kind === "not-found";
  const canActivate =
    hasExternalRuntimeConfigured &&
    !pathMissing &&
    !hasRunningSessions &&
    !!onActivate;
  const detail = !hasExternalRuntimeConfigured
    ? copy.needsGAPath
    : pathMissing
      ? copy.externalPathMissing
      : validation?.kind === "ok"
        ? copy.externalReady
        : copy.pathSet;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={cn(
            "min-w-0 flex-1 text-ui-meta",
            pathMissing ? "text-warning" : "text-ink-muted",
          )}
        >
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
