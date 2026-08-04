import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { DotsThreeVertical, LinkBreak, Pause } from "@phosphor-icons/react";

import { IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ChannelActionsMenu({
  disabled,
  canStop,
  canDisconnect,
  onStop,
  onDisconnect,
}: {
  disabled: boolean;
  canStop: boolean;
  canDisconnect: boolean;
  onStop: () => void;
  onDisconnect: () => void;
}) {
  const appCopy = useCopy();
  const imCopy = appCopy.settings.im;
  // rounded-callout (8px) = the menu surface's rounded-md (12px) minus
  // its p-1 (4px) — concentric nested corners (polish-checklist P1).
  const itemClass =
    "flex items-center gap-2 rounded-callout px-2 py-1.5 outline-none data-[highlighted]:bg-hover";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton ariaLabel={appCopy.common.more} size="sm">
          <DotsThreeVertical size={13} weight="bold" />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className={cn(
            "galley-pop-in z-[70] min-w-[132px] rounded-md border border-line bg-elevated p-1",
            "text-ui-compact text-ink shadow-elevated",
          )}
        >
          {canStop ? (
            <DropdownMenu.Item
              disabled={disabled}
              onSelect={onStop}
              className={cn(
                itemClass,
                "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
              )}
            >
              <Pause size={13} weight="thin" />
              {imCopy.pauseReceiving}
            </DropdownMenu.Item>
          ) : null}
          {canDisconnect ? (
            <DropdownMenu.Item
              disabled={disabled}
              onSelect={onDisconnect}
              className={cn(
                itemClass,
                "text-error data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
              )}
            >
              <LinkBreak size={13} weight="thin" />
              {imCopy.disconnect}
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
