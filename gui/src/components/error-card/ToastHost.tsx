import { useEffect } from "react";

import {
  ErrorCard,
  type ErrorCardActions,
} from "@/components/error-card/ErrorCard";
import type { AppError } from "@/types/app-error";

interface ToastHostProps extends ErrorCardActions {
  /** Active toasts (typically AppErrors with category bridge / business). */
  toasts: AppError[];
  onDismiss: (id: string) => void;
  /**
   * Auto-dismiss duration in ms for info toasts. Default 6000. Set 0
   * to disable. Warning / error toasts never auto-dismiss (unless the
   * toast itself opts in via its own `autoDismissMs`).
   */
  autoDismissMs?: number;
}

/**
 * Top-level toast container for non-runtime errors. DESIGN.md §6.2.
 *
 * Bridge / business errors render here so they don't fight for space
 * inside the conversation document. Stacks toasts in the bottom-left
 * corner so system feedback has one stable home without covering the
 * Settings close button or the Composer controls. Compact info toasts
 * should feel like quiet system feedback, while warning/error toasts
 * keep the fuller ErrorCard chrome.
 *
 * Toasts sit above modal dialogs because they are system feedback,
 * not content inside the active dialog. The container stays
 * pointer-events-none so it remains visually present without stealing
 * the surrounding interaction surface.
 *
 * Auto-dismiss is severity-gated: info toasts leave after
 * `autoDismissMs` (default 6s), while warning / error toasts stay
 * until manually dismissed — there is no toast history, so an
 * auto-dismissed error is information the user can never get back.
 * A toast's own `autoDismissMs` still overrides both (deliberate
 * per-call opt-in to a transient warning, e.g. clipboard fallbacks).
 */
export function ToastHost({
  toasts,
  onDismiss,
  autoDismissMs = 6000,
  ...actions
}: ToastHostProps) {
  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-[90] flex w-[320px] max-w-[calc(100vw-24px)] flex-col gap-2">
      {toasts.map((t) => (
        <ToastFrame
          key={t.id}
          toast={t}
          onDismiss={onDismiss}
          autoDismissMs={autoDismissMs}
          actions={actions}
        />
      ))}
    </div>
  );
}

function ToastFrame({
  toast,
  onDismiss,
  autoDismissMs,
  actions,
}: {
  toast: AppError;
  onDismiss: (id: string) => void;
  autoDismissMs: number;
  actions: ErrorCardActions;
}) {
  useEffect(() => {
    const dismissMs =
      toast.autoDismissMs ?? (toast.severity === "info" ? autoDismissMs : 0);
    if (dismissMs <= 0) return;
    const t = setTimeout(() => onDismiss(toast.id), dismissMs);
    return () => clearTimeout(t);
  }, [toast.id, toast.autoDismissMs, toast.severity, onDismiss, autoDismissMs]);

  return (
    <div className="pointer-events-auto animate-fade-in">
      <ErrorCard
        error={toast}
        variant="toast"
        onDismiss={() => onDismiss(toast.id)}
        {...actions}
        onRestartChannels={
          actions.onRestartChannels
            ? () => {
                onDismiss(toast.id);
                actions.onRestartChannels?.();
              }
            : undefined
        }
        onRestartAppUpdate={
          actions.onRestartAppUpdate
            ? () => {
                onDismiss(toast.id);
                actions.onRestartAppUpdate?.();
              }
            : undefined
        }
      />
    </div>
  );
}
