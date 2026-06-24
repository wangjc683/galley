import * as Dialog from "@radix-ui/react-dialog";
import { ArrowsClockwise, CircleNotch } from "@phosphor-icons/react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function RestartChannelsDialog({
  open,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const copy = useCopy();
  const imCopy = copy.settings.im;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby="restart-channels-desc"
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
            "max-w-[calc(100vw-32px)] rounded-lg border border-line bg-elevated p-5 shadow-elevated",
          )}
        >
          <div className="flex items-center gap-2">
            <ArrowsClockwise
              size={18}
              weight="bold"
              className="text-warning"
            />
            <Dialog.Title className="text-[15px] font-semibold text-ink">
              {imCopy.restartChannelsDialogTitle}
            </Dialog.Title>
          </div>
          <p
            id="restart-channels-desc"
            className="mt-2 text-[12.5px] leading-[1.55] text-ink-soft"
          >
            {imCopy.restartChannelsDialogBody}
          </p>
          <DialogActionRow>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              autoFocus
            >
              {copy.common.cancel}
            </Button>
            <Button
              variant="warning"
              disabled={busy}
              leadingIcon={
                busy ? (
                  <CircleNotch size={13} className="animate-spin" />
                ) : (
                  <ArrowsClockwise size={13} />
                )
              }
              onClick={onConfirm}
            >
              {copy.toasts.restartChannels}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
