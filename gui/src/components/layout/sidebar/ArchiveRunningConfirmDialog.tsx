import * as Dialog from "@radix-ui/react-dialog";
import { WarningCircle } from "@phosphor-icons/react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Confirm dialog for archiving a session that is still running (its
 * own run, or a goal it masters). Mirrors ConfirmDeleteProjectDialog's
 * alertdialog shape; warning tone (not error) because archiving is
 * reversible — the risk is losing SIGHT of live work, not losing data.
 */
export function ArchiveRunningConfirmDialog({
  title,
  open,
  onCancel,
  onConfirm,
}: {
  title: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = useCopy();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby="archive-running-desc"
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-elevated p-5 shadow-elevated",
            "max-w-[calc(100vw-32px)]",
          )}
        >
          <div className="flex items-center gap-2">
            <WarningCircle size={18} weight="bold" className="text-warning" />
            <Dialog.Title className="text-[15px] font-semibold text-ink">
              {copy.sidebar.archiveRunningTitle}
            </Dialog.Title>
          </div>
          <p
            id="archive-running-desc"
            className="mt-2 text-[12.5px] leading-[1.55] text-ink-soft"
          >
            {copy.sidebar.archiveRunningBody(title)}
          </p>
          <DialogActionRow>
            <Button variant="secondary" onClick={onCancel} autoFocus>
              {copy.common.cancel}
            </Button>
            <Button variant="warning" onClick={onConfirm}>
              {copy.sidebar.archiveRunningConfirm}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
