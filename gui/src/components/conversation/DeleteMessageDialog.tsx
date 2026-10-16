import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { COPY_FEEDBACK_MS, copyTextToClipboard } from "@/lib/clipboard";
import { useCopy } from "@/lib/i18n";
import {
  deleteFailure,
  deleteMainChatMessage,
  type DeleteFailure,
} from "@/lib/message-delete";

/**
 * The confirm before deleting one message of the main chat (main chat
 * ticket 32): its title and the button, nothing else (JC 2026-10-16:
 * 「对于用户来说，负担最小最容易理解」). One click — it reaches nothing
 * beyond this message (overlays-and-settings「确认弹窗」: the five-second
 * hold is for the reset). Cancel holds the focus. While Core deletes,
 * the dialog cannot be closed; a failure is written in it with its
 * detail to copy, as the reset's is; success closes it.
 */
export function DeleteMessageDialog({
  sessionId,
  messageId,
  onClose,
  onDelete = deleteMainChatMessage,
}: {
  sessionId: string;
  messageId: string;
  onClose: () => void;
  /** Does the deletion; rejects with Core's error. */
  onDelete?: (sessionId: string, messageId: string) => Promise<void>;
}) {
  const copy = useCopy().conversation.deleteMessage;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DeleteFailure | null>(null);

  return (
    <ConfirmActionDialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      busy={busy}
      icon={null}
      title={copy.title}
      body={failure ? <DeleteFailureLine failure={failure} /> : undefined}
      confirmLabel={copy.confirm}
      confirmVariant="destructive"
      onConfirm={() => {
        if (busy) return;
        setBusy(true);
        setFailure(null);
        onDelete(sessionId, messageId).then(onClose, (error: unknown) => {
          setBusy(false);
          setFailure(deleteFailure(error));
        });
      }}
    />
  );
}

function DeleteFailureLine({ failure }: { failure: DeleteFailure }) {
  const copy = useCopy().conversation.deleteMessage;
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 text-ui-tertiary text-error">
      <p className="m-0 min-w-0 flex-1">
        {failure.kind === "busy"
          ? copy.failedBusy
          : failure.kind === "subtasks"
            ? copy.failedSubtasks
            : copy.failed}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 shrink-0 px-1.5 text-ui-tertiary text-error/75 hover:text-error"
        onClick={() => {
          void copyTextToClipboard(failure.detail).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
          });
        }}
      >
        {copied ? copy.copied : copy.copyDetails}
      </Button>
    </div>
  );
}
