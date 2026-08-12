import { useEffect, useRef, useState } from "react";

import {
  ErrorCard,
  type ErrorCardActions,
} from "@/components/error-card/ErrorCard";
import { resumeDelay } from "@/lib/toast-timing";
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
 *
 * The countdown pauses while the pointer is over a toast or focus is
 * inside it — these toasts carry action buttons (restart channels, view
 * project, view goal, restart update), and a flat timer lets one vanish
 * while the user is reading it or on the way to clicking it.
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
  // `held` = pointer over the toast, or focus somewhere inside it. Focus
  // counts because the action buttons are reachable by keyboard, and a
  // countdown that ignores that would pull the button out from under Tab.
  const [held, setHeld] = useState(false);
  // Time left when the countdown was last paused; null = never started.
  const remainingRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const dismissMs =
    toast.autoDismissMs ?? (toast.severity === "info" ? autoDismissMs : 0);

  useEffect(() => {
    if (dismissMs <= 0 || held) return;
    const wait = resumeDelay(remainingRef.current, dismissMs);
    startedAtRef.current = performance.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), wait);
    return () => {
      window.clearTimeout(timer);
      // Bank what was left so the next run resumes rather than restarts.
      // This also runs on unmount, where the ref dies with the component.
      remainingRef.current = Math.max(
        0,
        wait - (performance.now() - startedAtRef.current),
      );
    };
  }, [toast.id, dismissMs, held, onDismiss]);

  return (
    <div
      className="pointer-events-auto animate-fade-in"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={(event) => {
        // Moving between two controls inside the toast is not leaving it.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setHeld(false);
      }}
    >
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
