import * as Dialog from "@radix-ui/react-dialog";
import { Lightning } from "@phosphor-icons/react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Confirm modal — shown when switching the app-wide DEFAULT approval
 * mode to 自动执行 (approval → auto widens unattended execution for
 * every non-overridden session). Shared by both entries that edit the
 * default: Settings → 审批 and the composer pill's footer segmented
 * control. Per-session pill switches never confirm — session-scoped,
 * reversible, described in place.
 *
 * Confirm button copy "是的，我知道在做什么" deliberately not "确定"
 * to prevent reflexive clicks.
 */
export function AutoDefaultConfirmModal({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const copy = useCopy();
  const approvalCopy = copy.settings.approval;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-[60] w-[480px] max-w-[calc(100vw-32px)]",
            "-translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-elevated p-7 shadow-elevated",
          )}
        >
          <div className="flex items-center gap-2">
            <Lightning size={20} weight="thin" className="text-warning" />
            <Dialog.Title className="text-[18px] font-semibold text-ink">
              {approvalCopy.turnOnAutoTitle}
            </Dialog.Title>
          </div>

          <div className="mt-4 space-y-3 text-ui-compact text-ink-soft">
            <p>{approvalCopy.autoModalIntro}</p>
            <ul className="space-y-1 pl-1 font-mono text-ui-secondary text-ink">
              <li>· {approvalCopy.filePatch}</li>
              <li>· {approvalCopy.fileWrite}</li>
              <li>· {approvalCopy.codeRun}</li>
              <li>· {approvalCopy.otherHighRisk}</li>
            </ul>
            <p>
              <span className="text-ink">{approvalCopy.goodFor}</span>
              {": "}
              {approvalCopy.goodForText}
            </p>
            <p>
              <span className="text-ink">{approvalCopy.notFor}</span>
              {": "}
              {approvalCopy.notForText}
            </p>
            <p className="text-ui-meta text-ink-muted">
              {approvalCopy.perSessionNote}
            </p>
          </div>

          <DialogActionRow className="mt-6">
            <Button
              variant="ghost"
              size="lg"
              onClick={() => onOpenChange(false)}
              autoFocus
            >
              {copy.common.cancel}
            </Button>
            <Button variant="warning" size="lg" onClick={onConfirm}>
              {approvalCopy.understandRisk}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
