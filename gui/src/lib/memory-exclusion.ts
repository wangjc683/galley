import type { AppCopy } from "@/lib/i18n";
import { memoryErrorText, type LedgerTarget } from "@/lib/memory";
import { useMemoryStore } from "@/stores/memory";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

/**
 * The title menu's and the project menu's 「不用于了解我」 (ticket 04b):
 * mark or unmark in Core, and on marking say once what it does — from
 * now on this is not read; what is already noted is deleted on the
 * memory page. Unmarking says nothing (the check mark going away is the
 * answer).
 */
export async function toggleLedgerExclusion(
  target: LedgerTarget,
  excluded: boolean,
  copy: AppCopy["memory"],
): Promise<void> {
  const pushToast = useUiStore.getState().pushToast;
  try {
    await useMemoryStore.getState().setExcluded(target, excluded);
  } catch (e) {
    pushToast(
      makeAppError({
        category: "business",
        severity: "error",
        title: copy.excludeFailed,
        message: memoryErrorText(e),
        hint: null,
        retryable: false,
        context: "set_ledger_excluded",
        traceback: null,
      }),
    );
    return;
  }
  if (!excluded) return;
  pushToast(
    makeAppError({
      category: "business",
      severity: "info",
      title:
        target.kind === "project"
          ? copy.excludedProjectTitle
          : copy.excludedSessionTitle,
      message: copy.excludedBody,
      hint: null,
      retryable: false,
      context: "set_ledger_excluded",
      traceback: null,
    }),
  );
}
