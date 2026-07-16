import * as Popover from "@radix-ui/react-popover";
import { CaretDown, Check } from "@phosphor-icons/react";

import {
  getManagedModelProviderPreset,
  managedModelProtocolLabel,
  MANAGED_MODEL_PROVIDER_PRESETS,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ManagedModelProtocol } from "@/types/managed-models";

interface ManagedModelProviderPickerProps {
  value: ManagedModelProviderPresetId | null;
  protocol: ManagedModelProtocol | null;
  onChange: (value: ManagedModelProviderPresetId) => void;
  ariaLabel?: string;
  className?: string;
}

export function ManagedModelProviderPicker({
  value,
  protocol,
  onChange,
  ariaLabel,
  className,
}: ManagedModelProviderPickerProps) {
  const copy = useCopy().settings.models;
  const selectedPreset = value ? getManagedModelProviderPreset(value) : null;
  const badgeLabel =
    selectedPreset?.id === "chatgpt-codex"
      ? copy.chatgptCodexBadge
      : protocol
        ? managedModelProtocolLabel(protocol)
        : null;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? copy.provider}
          className={cn(
            "group flex w-full min-w-[240px] items-center justify-between gap-3 rounded-sm border border-line bg-surface px-3 py-2 text-left",
            "outline-none hover:bg-hover focus:border-brand focus:ring-[3px] focus:ring-brand/20",
            "data-[state=open]:border-brand data-[state=open]:bg-hover data-[state=open]:ring-[3px] data-[state=open]:ring-brand/20",
            className,
          )}
        >
          <span className="min-w-0">
            <span
              className={cn(
                "block truncate text-ui-secondary font-medium",
                selectedPreset ? "text-ink" : "text-ink-muted",
              )}
            >
              {selectedPreset?.label ?? copy.chooseProvider}
            </span>
            {badgeLabel && (
              <span className="mt-1 inline-flex rounded-sm bg-ink-muted/10 px-1.5 py-px text-ui-micro text-ink-muted">
                {badgeLabel}
              </span>
            )}
          </span>
          <CaretDown
            size={12}
            weight="bold"
            className={cn(
              "shrink-0 text-ink-muted transition-transform duration-(--motion-fast)",
              "group-hover:text-ink-soft group-data-[state=open]:rotate-180 group-data-[state=open]:text-ink-soft",
            )}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          style={{
            maxHeight:
              "min(420px, var(--radix-popover-content-available-height))",
          }}
          className={cn(
            "z-[80] w-[var(--radix-popover-trigger-width)] overflow-auto rounded-sm border border-line bg-elevated p-1 shadow-elevated",
          )}
        >
          {MANAGED_MODEL_PROVIDER_PRESETS.map((preset) => {
            const selected = preset.id === value;
            const description = providerPresetDescription(copy, preset.id);
            return (
              <Popover.Close asChild key={preset.id}>
                <button
                  type="button"
                  onClick={() => onChange(preset.id)}
                  className={cn(
                    "flex w-full min-w-0 items-start gap-2 rounded-sm px-2.5 py-2 text-left outline-none hover:bg-hover focus:bg-hover",
                    selected ? "text-ink" : "text-ink-soft",
                  )}
                >
                  <span className="mt-0.5 flex w-3.5 shrink-0 items-center justify-center">
                    {selected && (
                      <Check
                        size={12}
                        weight="bold"
                        className="text-brand-strong"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui-secondary font-medium">
                      {preset.label}
                    </span>
                    {description && (
                      <span className="mt-0.5 block truncate text-ui-tertiary leading-4 text-ink-muted">
                        {description}
                      </span>
                    )}
                  </span>
                </button>
              </Popover.Close>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function providerPresetDescription(
  copy: ReturnType<typeof useCopy>["settings"]["models"],
  presetId: ManagedModelProviderPresetId,
): string | null {
  if (presetId === "custom-openai") {
    return copy.openaiPresetDescription;
  }
  if (presetId === "custom-anthropic") {
    return copy.anthropicPresetDescription;
  }
  if (presetId === "chatgpt-codex") {
    return copy.chatgptCodexPresetDescription;
  }
  return null;
}
