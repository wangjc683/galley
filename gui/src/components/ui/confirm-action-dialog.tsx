import * as Dialog from "@radix-ui/react-dialog";
import { CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { useId, type ReactNode } from "react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Shared light-confirm dialog (started life in Settings → Channels;
 * promoted to ui/ once the archived-sessions browser needed the same
 * shell). Confirms differ only in copy, header icon, and confirm
 * variant. Cancel is the autoFocus default — Enter never fires the
 * consequential action by reflex.
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  busy = false,
  icon,
  title,
  body,
  confirmLabel,
  confirmVariant = "destructive-soft",
  confirmIcon,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  /** Header icon. Defaults to a warning circle; pass `null` to omit
   * (plain title-only confirms, e.g. row deletes). */
  icon?: ReactNode | null;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  confirmVariant?: "destructive-soft" | "destructive" | "warning";
  /** Leading icon on the confirm button; swapped for a spinner while busy. */
  confirmIcon?: ReactNode;
  onConfirm: () => void;
}) {
  const copy = useCopy();
  const descId = useId();
  const headerIcon =
    icon === null ? null : (
      icon ?? (
        <WarningCircle size={18} weight="bold" className="text-warning" />
      )
    );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby={descId}
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
            "max-w-[calc(100vw-32px)] rounded-lg border border-line bg-elevated p-5 shadow-elevated",
          )}
        >
          <div className="flex items-center gap-2">
            {headerIcon}
            <Dialog.Title className="text-[15px] font-semibold text-ink">
              {title}
            </Dialog.Title>
          </div>
          <p
            id={descId}
            className="mt-2 text-ui-secondary leading-secondary text-ink-soft"
          >
            {body}
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
              variant={confirmVariant}
              disabled={busy}
              leadingIcon={
                busy ? (
                  <CircleNotch size={13} className="spin" />
                ) : (
                  confirmIcon
                )
              }
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
