import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import { ProviderPresetOptionText } from "@/components/managed-models/ManagedModelProviderPicker";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  MANAGED_MODEL_PROVIDER_PRESETS,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import { providerPresetLabel } from "@/lib/managed-model-preset-copy";

interface ManagedModelProviderAddMenuProps {
  variant: ButtonVariant;
  /** Asked before the menu opens; false keeps it shut. Settings refuses
   * while the open provider form holds unsaved input (and flags that
   * form), and otherwise closes the form first. */
  onOpenRequest: () => boolean;
  /** A card was chosen: open its create form. */
  onPick: (presetId: ManagedModelProviderPresetId) => void;
}

/**
 * Settings → 模型's 「添加」 is the card list itself (SIWC decision 16,
 * 2026-10-20): one click opens the presets, the same rows as the create
 * form's picker (name over description), and choosing one opens that
 * card's create form. Esc or a click outside chooses nothing. ↑ / ↓ and
 * Enter are Radix's menu keys. Before, 「添加」 opened an empty form
 * whose picker took two more clicks. The zero-provider page has no
 * 「添加」: its form opens by itself and keeps the picker.
 */
export function ManagedModelProviderAddMenu({
  variant,
  onOpenRequest,
  onPick,
}: ManagedModelProviderAddMenuProps) {
  const copy = useCopy().settings.models;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Same boundary as the picker: the Settings dialog, resolved when
  // the list opens, so the list flips / shortens inside the dialog's
  // frame instead of running past its bottom edge.
  const [dialogBoundary, setDialogBoundary] = useState<Element | null>(null);

  // Modal (Radix's default): Settings is a Dialog whose scroll lock
  // swallows wheel events on portaled content; the menu's own lock on
  // top lets the list scroll.
  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          if (!onOpenRequest()) return;
          setDialogBoundary(
            triggerRef.current?.closest('[role="dialog"]') ?? null,
          );
        }
        setOpen(next);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <Button
          ref={triggerRef}
          variant={variant}
          size="sm"
          aria-label={copy.addProviderAria}
          leadingIcon={<Plus size={12} weight="bold" />}
        >
          {copy.addProvider}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionBoundary={dialogBoundary ?? []}
          collisionPadding={12}
          style={{
            maxHeight:
              "min(420px, var(--radix-dropdown-menu-content-available-height))",
          }}
          className="galley-pop-in z-[80] w-[320px] overflow-auto rounded-sm border border-line bg-elevated p-1 shadow-elevated"
        >
          {MANAGED_MODEL_PROVIDER_PRESETS.map((preset) => (
            <DropdownMenu.Item
              key={preset.id}
              textValue={providerPresetLabel(copy, preset)}
              onSelect={() => onPick(preset.id)}
              className="flex w-full min-w-0 items-start rounded-sm px-2.5 py-2 text-left text-ink-soft outline-none data-[highlighted]:bg-hover"
            >
              <ProviderPresetOptionText preset={preset} />
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
