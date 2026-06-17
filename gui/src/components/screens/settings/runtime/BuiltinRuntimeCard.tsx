import { Key, Package } from "@phosphor-icons/react";

import { SettingsSectionLabel } from "@/components/screens/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { RuntimeKind } from "@/types/session";

export function BuiltinRuntimeCard({
  value,
  hasManagedRuntimeConfigured,
  hasRunningSessions,
  highlighted,
  onOpenModels,
  onActivate,
}: {
  value: RuntimeKind;
  hasManagedRuntimeConfigured: boolean;
  hasRunningSessions: boolean;
  highlighted: boolean;
  onOpenModels?: () => void;
  onActivate?: () => void;
}) {
  const appCopy = useCopy();
  const copy = appCopy.settings.runtime;
  const active = value === "galley_native";
  const canActivate =
    !active &&
    hasManagedRuntimeConfigured &&
    !hasRunningSessions &&
    !!onActivate;
  const needsModel = !hasManagedRuntimeConfigured;
  const detail = active
    ? copy.usingGalleyNative
    : needsModel
      ? copy.galleyNativeNeedsModel
      : copy.galleyNativeReady;

  return (
    <div>
      <SettingsSectionLabel>{copy.runtimeMode}</SettingsSectionLabel>
      <div
        className={cn(
          "mt-2 rounded-sm border border-line bg-surface px-3 py-3",
          highlighted && "runtime-mode-highlight",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Package
              size={18}
              weight="thin"
              className="shrink-0 text-ink-soft"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-ink">
                  {copy.galleyNative}
                </span>
                <span className="rounded-sm bg-brand-soft px-1.5 py-px text-[10.5px] font-medium text-brand-strong">
                  {copy.recommended}
                </span>
                {active && (
                  <span className="rounded-sm bg-hover px-1.5 py-px text-[10.5px] text-ink-muted">
                    {copy.active}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[12px] text-ink-muted">{detail}</div>
            </div>
          </div>
          {needsModel ? (
            <Button
              variant="primary"
              size="sm"
              disabled={!onOpenModels}
              onClick={onOpenModels}
              leadingIcon={<Key size={12} weight="thin" />}
            >
              {appCopy.sidebar.configureModels}
            </Button>
          ) : (
            !active && (
              <Button
                variant="primary"
                size="sm"
                disabled={!canActivate}
                onClick={onActivate}
              >
                {copy.switchToGalleyNative}
              </Button>
            )
          )}
        </div>
        {hasRunningSessions && !active && (
          <div className="mt-2 text-[11.5px] text-ink-muted">
            {copy.runningSessionsBlock}
          </div>
        )}
      </div>
    </div>
  );
}
