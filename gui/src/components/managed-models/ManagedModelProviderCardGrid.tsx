import { Check } from "@phosphor-icons/react";

import { providerPresetDescription } from "@/lib/managed-model-preset-copy";
import { useCopy } from "@/lib/i18n";
import {
  MANAGED_MODEL_PROVIDER_PRESETS,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import { cn } from "@/lib/utils";

interface ManagedModelProviderCardGridProps {
  value: ManagedModelProviderPresetId | null;
  onChange: (value: ManagedModelProviderPresetId) => void;
  className?: string;
}

/**
 * Flat card grid over the provider presets — the Onboarding variant of
 * ManagedModelProviderPicker. All choices are visible at once so the
 * first decision costs one click instead of open-dropdown → scan →
 * pick. Settings keeps the compact popover picker.
 */
export function ManagedModelProviderCardGrid({
  value,
  onChange,
  className,
}: ManagedModelProviderCardGridProps) {
  const copy = useCopy().settings.models;

  return (
    <div
      role="radiogroup"
      aria-label={copy.provider}
      className={cn("grid grid-cols-2 gap-2", className)}
    >
      {MANAGED_MODEL_PROVIDER_PRESETS.map((preset) => {
        const selected = preset.id === value;
        const description = providerPresetDescription(copy, preset.id);
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(preset.id)}
            className={cn(
              "group relative rounded-sm border px-3 py-2 text-left outline-none",
              "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
              "focus-visible:ring-[3px] focus-visible:ring-brand/20",
              selected
                ? "border-brand bg-brand-soft/60 ring-[3px] ring-brand/20"
                : "border-line bg-elevated hover:border-line-strong hover:bg-hover",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "min-w-0 truncate text-[13px] font-medium",
                  selected ? "text-ink" : "text-ink-soft",
                )}
              >
                {preset.label}
              </span>
              {selected && (
                <Check
                  size={12}
                  weight="bold"
                  className="shrink-0 text-brand-strong"
                />
              )}
            </span>
            {description && (
              <span className="mt-0.5 block truncate text-[11.5px] leading-4 text-ink-muted">
                {description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
