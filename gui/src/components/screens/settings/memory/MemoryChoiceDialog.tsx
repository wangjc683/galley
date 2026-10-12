import * as Dialog from "@radix-ui/react-dialog";
import { CircleNotch } from "@phosphor-icons/react";
import { useId } from "react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface MemoryChoice {
  key: string;
  label: string;
  detail: string;
  /** The choice deletes something. */
  destructive?: boolean;
}

/**
 * The two-way choice behind the memory switch (ticket 04b): turning it
 * on asks 「从现在开始 / 也读以前的对话」, turning it off 「保留已记下的 /
 * 一起清空」. The switch itself does not move until a choice is made.
 *
 * A forced-choice dialog, so no X (Dialog 关闭按钮 rule): 取消 or Esc
 * leaves everything as it was. Stacked full-width choices, each with
 * the one line that says what it costs; the second tier above Settings
 * (z-60, like ConfirmActionDialog). Cancel has the focus, so Enter never
 * picks a choice by reflex.
 */
export function MemoryChoiceDialog({
  open,
  onOpenChange,
  title,
  body,
  choices,
  busyKey,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  choices: readonly MemoryChoice[];
  /** The choice being carried out; every control waits meanwhile. */
  busyKey: string | null;
  onChoose: (key: string) => void;
}) {
  const copy = useCopy();
  const descId = useId();
  const busy = busyKey !== null;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby={descId}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
            "max-w-[calc(100vw-32px)] rounded-lg border border-line bg-elevated p-5 shadow-elevated",
          )}
        >
          <Dialog.Title className="text-[15px] font-semibold text-ink">
            {title}
          </Dialog.Title>
          <p
            id={descId}
            className="mt-2 text-ui-secondary leading-secondary text-ink-soft"
          >
            {body}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                disabled={busy}
                onClick={() => onChoose(choice.key)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-left",
                  "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                  "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
                  "hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-ui-compact font-medium",
                      choice.destructive ? "text-error" : "text-ink",
                    )}
                  >
                    {choice.label}
                  </span>
                  <span className="mt-0.5 block text-ui-meta leading-dense text-ink-muted">
                    {choice.detail}
                  </span>
                </span>
                {busyKey === choice.key && (
                  <CircleNotch
                    size={13}
                    weight="thin"
                    className="spin mt-0.5 shrink-0 text-ink-muted"
                  />
                )}
              </button>
            ))}
          </div>
          <DialogActionRow>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              autoFocus
            >
              {copy.common.cancel}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
