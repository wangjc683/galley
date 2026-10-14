import { useEffect, useEffectEvent, useState } from "react";

import { SettingsNavRow } from "@/components/screens/settings/settings-disclosure";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { HoldToConfirmButton } from "@/components/ui/hold-to-confirm-button";
import { COPY_FEEDBACK_MS, copyTextToClipboard } from "@/lib/clipboard";
import { HoldToConfirm, holdKeyAction } from "@/lib/hold-to-confirm";
import { useCopy } from "@/lib/i18n";
import {
  resetFailure,
  resetMainChat,
  type ResetFailure,
} from "@/lib/main-chat-reset";

/**
 * Settings → 运行环境 → 更多, last row: 重置主对话 (main chat ticket 15,
 * PRD ruling 59). Rendered only on the managed runtime with a main chat;
 * disabled while a conversation runs, the reason in the subtitle (the
 * setup assistant row's pattern). It opens the confirm; the reset itself
 * is Core's.
 */
export function ResetMainChatAccess({
  hasRunningSessions,
}: {
  hasRunningSessions: boolean;
}) {
  const copy = useCopy().settings.runtime.resetMainChat;
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingsNavRow
        title={copy.title}
        subtitle={hasRunningSessions ? copy.runningBlock : copy.description}
        disabled={hasRunningSessions}
        onOpen={() => setOpen(true)}
      />
      {/* Mounted only while open: every opening starts clean. */}
      {open && (
        <ResetMainChatDialog
          open
          onOpenChange={setOpen}
          hasRunningSessions={hasRunningSessions}
        />
      )}
    </>
  );
}

/**
 * The confirm: what goes, what stays, what cannot be called back, and a
 * button held for five seconds. Over Settings (`z-60`, the shared
 * confirm shell); Cancel holds the focus, no key confirms. A failure is
 * written in the dialog with its detail to copy; success closes it (the
 * reset closes Settings and lands on the new main chat).
 */
export function ResetMainChatDialog({
  open,
  onOpenChange,
  hasRunningSessions,
  onReset = resetMainChat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasRunningSessions: boolean;
  /** Does the reset; rejects with Core's error. */
  onReset?: () => Promise<void>;
}) {
  const copy = useCopy().settings.runtime.resetMainChat;
  const [hold] = useState(() => new HoldToConfirm());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ResetFailure | null>(null);

  const onConfirmed = useEffectEvent(() => {
    if (busy || hasRunningSessions) return;
    setBusy(true);
    setFailure(null);
    onReset().then(
      () => onOpenChange(false),
      (error: unknown) => {
        setBusy(false);
        setFailure(resetFailure(error));
      },
    );
  });
  useEffect(() => {
    hold.setOnConfirm(() => onConfirmed());
    return () => {
      hold.setOnConfirm(null);
      hold.dispose();
    };
  }, [hold]);

  return (
    <ConfirmActionDialog
      open={open}
      // Nothing closes it while the reset runs.
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
      busy={busy}
      title={copy.dialogTitle}
      // Room under the button for 「要按住不放」, so the hint never moves
      // the button (a move under a held pointer would let go).
      className="pb-7"
      // Esc during a hold lets go of it and leaves the dialog open; the
      // next Esc closes it.
      onEscapeKeyDown={(event) => {
        if (
          holdKeyAction(event.key) === "cancel" &&
          hold.getSnapshot().holding
        ) {
          event.preventDefault();
          hold.cancel();
        }
      }}
      body={
        <ResetMainChatBody
          hasRunningSessions={hasRunningSessions && !busy}
          failure={failure}
        />
      }
      confirmSlot={
        <HoldToConfirmButton
          hold={hold}
          label={copy.hold}
          busyLabel={copy.resetting}
          hint={copy.holdHint}
          busy={busy}
          disabled={hasRunningSessions}
        />
      }
    />
  );
}

export function ResetMainChatBody({
  hasRunningSessions,
  failure,
}: {
  hasRunningSessions: boolean;
  failure: ResetFailure | null;
}) {
  const copy = useCopy().settings.runtime.resetMainChat;
  return (
    <>
      <p>{copy.dialogBody}</p>
      <ResetScope label={copy.deletesLabel} items={copy.deletes} />
      <ResetScope label={copy.keepsLabel} items={copy.keeps} />
      <p className="mt-3">{copy.unrecoverable}</p>
      {hasRunningSessions && (
        <p className="mt-3 text-ui-tertiary text-ink-muted">
          {copy.runningBlock}
        </p>
      )}
      {failure && <ResetFailureLine failure={failure} />}
    </>
  );
}

function ResetScope({
  label,
  items,
}: {
  label: string;
  items: readonly string[];
}) {
  return (
    <div className="mt-3">
      <div className="text-ui-tertiary font-medium text-ink">{label}</div>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => (
          <li key={item} className="flex min-w-0 gap-2">
            <span
              aria-hidden
              className="mt-[0.65em] size-1 shrink-0 rounded-full bg-ink-muted/60"
            />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResetFailureLine({ failure }: { failure: ResetFailure }) {
  const copy = useCopy().settings.runtime.resetMainChat;
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex items-start gap-2 text-ui-tertiary text-error">
      <p className="m-0 min-w-0 flex-1">
        {failure.kind === "running" ? copy.failedRunning : copy.failed}
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
