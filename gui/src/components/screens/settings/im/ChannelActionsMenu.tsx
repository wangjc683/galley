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
  const itemClass =
    "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-hover";

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
            "z-[70] min-w-[132px] rounded-md border border-line bg-elevated p-1",
            "text-[13px] text-ink shadow-elevated",
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
