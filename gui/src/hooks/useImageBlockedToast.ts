import type { AppCopy } from "@/lib/i18n";
import { makeAppError, type AppError } from "@/types/app-error";

export type ImageBlockedReason =
  | "goal"
  | "external"
  | "too-large"
  | "unsupported"
  | "too-many";

/**
 * Centralized reason → copy routing for the Composer's onImageBlocked.
 * The Composer only emits the reason; the toast copy (and which key it
 * lives under) is an App-level concern, so the mapping stays here.
 */
export function useImageBlockedToast({
  copy,
  pushToast,
}: {
  copy: AppCopy;
  pushToast: (error: AppError) => void;
}) {
  const showImageBlockedToast = (message: string) => {
    pushToast(
      makeAppError({
        category: "business",
        severity: "error",
        title: copy.toasts.imageBlocked,
        message,
        hint: null,
        retryable: false,
        context: "imagePaste",
        traceback: null,
        autoDismissMs: 4200,
      }),
    );
  };
  const handleImageBlocked = (reason: ImageBlockedReason) => {
    const message =
      reason === "goal"
        ? copy.toasts.imageBlockedGoal
        : reason === "external"
          ? copy.toasts.imageBlockedExternal
          : reason === "too-large"
            ? copy.toasts.imageTooLarge
            : reason === "too-many"
              ? copy.toasts.imageTooMany
              : copy.toasts.imageUnsupported;
    showImageBlockedToast(message);
  };
  /** A native drop carried no filesystem paths (text / URL drag). The
   * interception loses the dragged content (PRD 定案 8), so all we can
   * do is explain the copy-paste route. Warning, not error — nothing the
   * user had is lost. */
  const handleTextDropBlocked = () => {
    pushToast(
      makeAppError({
        category: "business",
        severity: "warning",
        title: copy.toasts.textDropBlocked,
        message: copy.toasts.textDropBlockedMessage,
        hint: null,
        retryable: false,
        context: "textDrop",
        traceback: null,
        autoDismissMs: 4200,
      }),
    );
  };
  return { showImageBlockedToast, handleImageBlocked, handleTextDropBlocked };
}
