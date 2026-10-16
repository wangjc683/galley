import * as Dialog from "@radix-ui/react-dialog";
import { CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { useId, type ReactNode } from "react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The confirm control: the usual button, or — for a confirm that cannot
 * be taken back — a control of the caller's own in its place (resetting
 * the main chat holds a button for five seconds). */
type ConfirmControl =
  | {
      confirmLabel: string;
      confirmVariant?: "destructive-soft" | "destructive" | "warning";
      /** Leading icon on the confirm button; swapped for a spinner while busy. */
      confirmIcon?: ReactNode;
      onConfirm: () => void;
      confirmSlot?: never;
    }
  | {
      confirmSlot: ReactNode;
      confirmLabel?: never;
      confirmVariant?: never;
      confirmIcon?: never;
      onConfirm?: never;
    };

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
  className,
  onEscapeKeyDown,
  confirmLabel,
  confirmVariant = "destructive-soft",
  confirmIcon,
  onConfirm,
  confirmSlot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  /** Header icon. Defaults to a warning circle; pass `null` to omit
   * (plain title-only confirms, e.g. row deletes). */
  icon?: ReactNode | null;
  title: string;
  /** Text, or blocks (paragraphs, lists): the body is a `div`. Left out
   * (or null) when the title says it all: no empty paragraph then, the
   * actions sit under the title. (Deleting one message of the main chat
   * was the one such confirm, ticket 32; since ticket 38 it asks
   * nothing and offers an undo instead.) */
  body?: ReactNode;
  /** Extra classes on the dialog panel. */
  className?: string;
  /** Radix's Esc hook: `preventDefault()` keeps the dialog open. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
} & ConfirmControl) {
  const copy = useCopy();
  const descId = useId();
  const hasBody = body !== undefined && body !== null && body !== false;
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
          aria-describedby={hasBody ? descId : undefined}
          onEscapeKeyDown={onEscapeKeyDown}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
            "max-w-[calc(100vw-32px)] rounded-lg border border-line bg-elevated p-5 shadow-elevated",
            className,
          )}
        >
          <div className="flex items-center gap-2">
            {headerIcon}
            <Dialog.Title className="text-[15px] font-semibold text-ink">
              {title}
            </Dialog.Title>
          </div>
          {hasBody && (
            <div
              id={descId}
              className="mt-2 text-ui-secondary leading-secondary text-ink-soft"
            >
              {body}
            </div>
          )}
          <DialogActionRow>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              autoFocus
            >
              {copy.common.cancel}
            </Button>
            {confirmSlot ?? (
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
            )}
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
