import * as Dialog from "@radix-ui/react-dialog";
import { WarningCircle } from "@phosphor-icons/react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface ProviderDeleteCandidate {
  name: string;
  modelCount: number;
}

interface ConfirmDeleteProviderDialogProps {
  candidate: ProviderDeleteCandidate | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteProviderDialog({
  candidate,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDeleteProviderDialogProps) {
  const appCopy = useCopy();
  const copy = appCopy.settings.models;
  return (
    <Dialog.Root
      open={!!candidate}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby="confirm-delete-provider-desc"
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
            "max-w-[calc(100vw-32px)] rounded-lg border border-line bg-elevated p-5 shadow-elevated",
          )}
        >
          <div className="flex items-center gap-2">
            <WarningCircle size={18} weight="bold" className="text-error" />
            <Dialog.Title className="text-[15px] font-semibold text-ink">
              {copy.deleteProviderDialogTitle}
            </Dialog.Title>
          </div>
          <p
            id="confirm-delete-provider-desc"
            className="mt-2 text-ui-secondary leading-secondary text-ink-soft"
          >
            {candidate
              ? copy.deleteProviderDialogBody(
                  candidate.name,
                  candidate.modelCount,
                )
              : ""}{" "}
            <span className="text-ink">{copy.cannotUndo}</span>
          </p>

          <DialogActionRow>
            <Button
              variant="secondary"
              onClick={onCancel}
              disabled={busy}
              autoFocus
            >
              {appCopy.common.cancel}
            </Button>
            <Button variant="destructive" onClick={onConfirm} disabled={busy}>
              {copy.deleteProviderDialogAction}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
