import { WarningCircle } from "@phosphor-icons/react";

import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useCopy } from "@/lib/i18n";

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
  const copy = useCopy().settings.models;
  // The shared confirm shell, with the delete-specific parts passed in:
  // an error-tinted header icon (provider delete drops every model under
  // it, a step past the warning-tier confirms) and the hard
  // `destructive` confirm.
  return (
    <ConfirmActionDialog
      open={!!candidate}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
      busy={busy}
      icon={<WarningCircle size={18} weight="bold" className="text-error" />}
      title={copy.deleteProviderDialogTitle}
      body={
        <>
          {candidate
            ? copy.deleteProviderDialogBody(
                candidate.name,
                candidate.modelCount,
              )
            : ""}{" "}
          <span className="text-ink">{copy.cannotUndo}</span>
        </>
      }
      confirmLabel={copy.deleteProviderDialogAction}
      confirmVariant="destructive"
      onConfirm={onConfirm}
    />
  );
}
