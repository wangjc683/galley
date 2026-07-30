import type { ReactNode } from "react";

import type {
  ComposerApprovalModeState,
  ComposerLLMOption,
} from "@/components/conversation/LLMPill";
import type { ImageBlockReason } from "@/lib/composer-images";
import type { PendingImageAttachment } from "@/types/conversation";
import type { GoalBrief, GoalLaunchConfig } from "@/types/goal";

/**
 * Imperative handle exposed via `ref` on Composer. Lets callers
 * imperatively seed the textarea with new content without a
 * controlled-mode rewrite of the whole paste-fold registry.
 * `focus()` is a thin pass-through.
 */
export interface ComposerHandle {
  /**
   * Replace the Composer's text with `text`. Clears the paste-fold
   * registry first (the new text isn't a user paste so there are no
   * placeholders to track) and focuses the textarea with the caret at
   * the end so the user can immediately edit / submit.
   */
  prefillText(text: string): void;
  focus(): void;
}

export interface ComposerProps {
  /** Display name of the currently active LLM (e.g., "Claude Sonnet 4.5"). */
  llmDisplayName: string;

  /** Controlled value (optional; uncontrolled if omitted). */
  value?: string;
  onChange?: (text: string) => void;

  /** Submit handler. Triggered by Enter (without Shift) or clicking the
   * submit button. Receives the trimmed text. */
  onSubmit?: (
    text: string,
    attachments: PendingImageAttachment[],
  ) => boolean | void;
  /** Start the current text as a desktop Goal instead of sending it to GA. */
  onGoalSubmit?: (
    text: string,
    config: GoalLaunchConfig,
  ) => void | Promise<void>;

  /** When true, hide submit and show the deep-amber stop button. */
  stopMode?: boolean;
  /**
   * True after the user clicks Stop, until the bridge confirms the run
   * ended. The Stop button shows a persistent pulse halo + "停止中…"
   * label and ignores further clicks so a second abort can't stack.
   */
  isStopping?: boolean;
  onStop?: () => void;

  /**
   * Counter bumped by the host after it accepts a user submit.
   * Replays a one-shot acknowledgement around the action slot, even
   * if the slot immediately flips from Send to Stop.
   */
  submitAckTick?: number;

  /** When true, the textarea is read-only and submit/stop are disabled. */
  disabled?: boolean;

  placeholder?: string;

  /**
   * Key for the in-memory draft parking lot (lib/composer-draft.ts).
   * When set (and the Composer is uncontrolled), the draft — text,
   * expanded paste-folds, image attachments — survives unmount and is
   * restored on the next mount with the same key. MainView passes the
   * session id; EmptyState passes "empty-state". Without it, a session
   * switch silently destroys a half-written message.
   */
  draftKey?: string;

  /**
   * LLM list for the inline dropdown. When provided + non-empty, the
   * Composer renders its own Radix Popover under the LLM pill (the
   * ChatGPT / Claude UX). When empty / undefined, the pill becomes a
   * fallback button that calls `onOpenLLMSwitcher` instead — used by
   * pre-bridge states or by callers that prefer the Command Palette
   * route.
   */
  llms?: ComposerLLMOption[];
  /** Called when the user picks an LLM from the inline dropdown. */
  onSelectLLM?: (index: number) => void;
  /** Quiet footer hint in the LLM dropdown. Runtime-specific because
   * managed mode should not teach users about external GA internals. */
  llmConfigHint?: string;
  /** Opens the model configuration surface from the LLM dropdown. */
  onConfigureModels?: () => void;
  /** When true, a submit attempt opens Models instead of sending. */
  requiresModelConfig?: boolean;
  /** Fallback click handler for the LLM pill when `llms` is not
   * provided. Today the only caller using this path is the dev-toggle
   * harness; production wires `llms` + `onSelectLLM`. */
  onOpenLLMSwitcher?: () => void;
  /** Approval-mode pill state (自动执行 / 逐步审批). Undefined hides
   * the pill (e.g. dev harness without session context). */
  approvalMode?: ComposerApprovalModeState;
  /** Active Goal in this Composer's Project context, if any. */
  goal?: GoalBrief;
  /** True when a Goal is active anywhere. Galley runs at most one Goal at a
   * time, so the Goal entry is disabled here (with an explanatory tooltip)
   * unless this Composer is the one already showing that Goal via `goal`. */
  hasActiveGoal?: boolean;
  /** Name of the project a Goal launched here would run in — the
   * session's project (MainView) or the active project filter
   * (EmptyState). Undefined = no project context: the backend will
   * create a fresh project to hold the run. Either way the confirm
   * dialog says so, instead of deciding it silently. */
  goalProjectName?: string;
  /** Show the compact keyboard/state hint below the Composer. */
  showFooterHint?: boolean;
  /** Caller-supplied content for the same footer slot, shown when the
   * internal keyboard/state hint is off. Keeps every hint under every
   * Composer in one visual grammar (mt-1.5 / 11px / left-aligned) —
   * EmptyState routes its "will be created in X" consequence line here
   * instead of rendering its own row. ReactNode so callers can carry a
   * content-level genre marker (e.g. the project row's folder icon),
   * parallel to how keyboard hints self-identify via kbd tokens. */
  staticHint?: ReactNode;
  /** When false, all image intake (paste / drop / file picker) is
   * disabled and the 📎 button is hidden — used for runtimes that
   * cannot deliver images to the agent (external GA). Defaults to
   * true so existing callers keep working. */
  imagesEnabled?: boolean;
  /** Called when an image is rejected at intake or submit. `reason`
   * selects the toast copy:
   *   - `"goal"`: image present on a Goal / /btw / reply path
   *   - `"external"`: image intake on a non-image-capable runtime
   *   - `"too-large"`: single image exceeds the client size cap
   *   - `"unsupported"`: mime not in the supported set (HEIC, GIF, …)
   * Replaces the old `onImageSubmitBlocked` (only carried `"goal"`). */
  onImageBlocked?: (reason: ImageBlockReason) => void;
  /** Called when a native drop carries no filesystem paths (text / URL
   * drag). The interception loses the dragged content, so the app-level
   * handler toasts "use copy & paste" — the accepted trade-off of native
   * drag-drop (PRD 定案 8). */
  onTextDropBlocked?: () => void;
}
