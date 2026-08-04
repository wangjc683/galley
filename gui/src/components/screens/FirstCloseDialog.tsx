import * as Dialog from "@radix-ui/react-dialog";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { isWindows } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface FirstCloseDialogProps {
  /** Driven by useFirstCloseRequest — Rust emits the open request when
   * the first `CloseRequested` arrives with no recorded choice. */
  open: boolean;
  /** Dismissal without a verdict (Esc / overlay click): the close is
   * simply cancelled — the window stays, nothing persists, and the
   * dialog asks again on the next close. */
  onOpenChange: (open: boolean) => void;
  /** The verdict. `keepInBackground: true` hides to the menu bar /
   * tray; `false` quits (with the running-agent confirm). Either way
   * the choice is remembered — this dialog appears once per device. */
  onChoose: (keepInBackground: boolean) => void;
}

/**
 * First-close choice dialog — replaces the old native message box.
 *
 * The first time the user closes the window, Rust keeps it visible
 * and asks what closing should mean, instead of hiding first and
 * explaining after the fact. This turns the one-time interruption
 * into the moment the `keep_in_background_on_close` preference gets
 * its value: teaching (what Background Mode does for you) and
 * decision (keep it?) in a single surface, in Galley's own visual
 * language.
 *
 * Unlike YoloIntroDialog this one is dismissable: Esc / overlay click
 * cancels the close entirely. That's a real third answer — "not now" —
 * and it costs nothing because the dialog just asks again next time.
 * Stacked full-width buttons (not a side-by-side pair): the choice is
 * primary-vs-secondary in consequence, not left-vs-right in symmetry.
 */
export function FirstCloseDialog({
  open,
  onOpenChange,
  onChoose,
}: FirstCloseDialogProps) {
  const copy = useCopy();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-elevated p-6 shadow-elevated",
            "max-w-[calc(100vw-32px)]",
          )}
        >
          <Dialog.Title className="text-[17px] font-semibold text-ink">
            {copy.firstClose.title}
          </Dialog.Title>

          <p className="m-0 mt-3 text-[13.5px] leading-[1.65] text-ink-soft">
            {isWindows ? copy.firstClose.bodyWindows : copy.firstClose.bodyMac}
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <Button autoFocus className="w-full" onClick={() => onChoose(true)}>
              {copy.firstClose.keep}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => onChoose(false)}
            >
              {copy.firstClose.quit}
            </Button>
          </div>

          <p className="m-0 mt-4 text-center text-ui-meta text-ink-muted">
            {copy.firstClose.footnote}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
