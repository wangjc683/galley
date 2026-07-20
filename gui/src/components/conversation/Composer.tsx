import {
  ArrowUp,
  Gear,
  Paperclip,
  Stop,
  Target,
  X,
} from "@phosphor-icons/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { GoalConfirmDialog } from "@/components/conversation/GoalConfirmDialog";
import { ImagePreviewDialog } from "@/components/conversation/ImagePreviewDialog";
import {
  LLMPill,
  type ComposerApprovalModeState,
  type ComposerLLMOption,
} from "@/components/conversation/LLMPill";
import { SavedPromptControl } from "@/components/conversation/SavedPromptControl";
import {
  COMPOSER_CONFIG_BUTTON,
  COMPOSER_GOAL_BUTTON,
  COMPOSER_GOAL_BUTTON_ARMED,
  COMPOSER_MAX_HEIGHT_PX,
  COMPOSER_SEND_BUTTON,
  COMPOSER_STOP_BUTTON,
  COMPOSER_TERTIARY_ICON_BUTTON,
} from "@/components/conversation/composer-styles";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useBlurOnOutsidePointer } from "@/hooks/useBlurOnOutsidePointer";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { usePasteFold } from "@/hooks/usePasteFold";
import { IMAGE_ACCEPT, type ImageBlockReason } from "@/lib/composer-images";
import {
  dropComposerDraft,
  readComposerDraft,
  saveComposerDraft,
} from "@/lib/composer-draft";
import { useCopy } from "@/lib/i18n";
import { goalPillLabel } from "@/lib/goals";
import { isImeCompositionKeydown } from "@/lib/ime";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";
import type { PendingImageAttachment } from "@/types/conversation";
import type { GoalBrief, GoalLaunchConfig } from "@/types/goal";

export type { ComposerLLMOption };
export type { ComposerApprovalModeState };

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

const COMPOSER_HINT_KBD = new Set(["Shift+Enter", "Enter", "/btw"]);

// Re-exported so callers wiring `onImageBlocked` keep importing the
// block-reason contract from the Composer; the type itself now lives with
// the image helpers in `@/lib/composer-images`.
export type { ImageBlockReason };

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
  autoFocus?: boolean;

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
}

/**
 * Composer — text input + LLM switcher + submit/stop. Per DESIGN.md §4.4.
 *
 * Apricot focus ring is the brand moment; submit button is the only
 * place we use apricot as a CTA fill. When the agent is running,
 * stopMode replaces submit with a deep-amber Stop button at the same
 * position.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      llmDisplayName,
      value,
      onChange,
      onSubmit,
      stopMode = false,
      isStopping = false,
      onStop,
      submitAckTick = 0,
      disabled = false,
      placeholder,
      autoFocus = false,
      draftKey,
      llms,
      onSelectLLM,
      llmConfigHint,
      onConfigureModels,
      requiresModelConfig = false,
      onOpenLLMSwitcher,
      approvalMode,
      goal,
      hasActiveGoal = false,
      goalProjectName,
      onGoalSubmit,
      showFooterHint = false,
      staticHint,
      imagesEnabled = true,
      onImageBlocked,
    },
    ref,
  ) {
    const copy = useCopy();
    // Hybrid controlled / uncontrolled. When `value` prop is provided
    // we render it directly; otherwise we maintain an internal copy.
    // Avoid syncing prop -> internal in an effect (React 19 / Compiler
    // flags that as cascading-render-prone) — derive on render instead.
    // Uncontrolled state seeds from the parked draft (if any) — the
    // Composer is keyed per session, so a switch-back remounts here.
    // Snapshot once on mount; the parking lot is not reactive.
    const [initialDraft] = useState(() =>
      draftKey && value === undefined ? readComposerDraft(draftKey) : undefined,
    );
    const [internal, setInternal] = useState(initialDraft?.text ?? "");
    const [goalArmed, setGoalArmed] = useState(false);
    const [goalConfirmOpen, setGoalConfirmOpen] = useState(false);
    const [goalConfirmationObjective, setGoalConfirmationObjective] =
      useState("");
    const [goalSubmitting, setGoalSubmitting] = useState(false);
    const [showByTheWayRequiredHint, setShowByTheWayRequiredHint] =
      useState(false);
    const [showGoalBlockedHint, setShowGoalBlockedHint] = useState(false);
    const isControlled = value !== undefined;
    const text = isControlled ? value : internal;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const composerRootRef = useRef<HTMLDivElement>(null);

    // Image attachments (pending tiles, hidden file input, preview dialog,
    // and the paste / drop / picker intake) live in their own hook so the
    // object-URL lifetime bookkeeping doesn't tangle with the textarea.
    const {
      pendingImages,
      hasPendingImages,
      previewImages,
      previewIndex,
      setPreviewIndex,
      fileInputRef,
      isDropActive,
      handleDragEnter,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleFileInputChange,
      tryAcceptPastedImages,
      removeImage,
      clearImages,
    } = useImageAttachments({
      imagesEnabled,
      onImageBlocked,
      pastedImageAlt: copy.composer.pastedImage,
      initialImages: initialDraft?.images,
      // With a draft key, the parking lot owns preview object URLs
      // across unmount; without one, the hook's unmount sweep applies.
      retainImagesOnUnmount: Boolean(draftKey) && !isControlled,
    });

    // Long-paste folding ([Pasted text #N +M lines]) + its registry and
    // caret restoration. `applyValue` is the uncontrolled commit path —
    // the hook only reaches it after clearing its own isControlled gate.
    const { handleTextPaste, expandPastePlaceholders, resetPasteRegistry } =
      usePasteFold({
        text,
        isControlled,
        textareaRef,
        applyValue: (next) => {
          setInternal(next);
          onChange?.(next);
        },
      });

    useEffect(() => {
      if (autoFocus && textareaRef.current) {
        textareaRef.current.focus();
      }
    }, [autoFocus]);

    // Draft parking (write-through): every text / attachment change
    // updates the parked draft so unmount needs no save step (an
    // unmount-time save could race the image hook's URL bookkeeping).
    // Text is stored expanded — see lib/composer-draft.ts.
    useEffect(() => {
      if (!draftKey || isControlled) return;
      saveComposerDraft(draftKey, {
        text: expandPastePlaceholders(text),
        images: pendingImages,
      });
    }, [draftKey, isControlled, text, pendingImages, expandPastePlaceholders]);

    // Blur-on-outside-pointer WebView focus workaround (see the hook).
    useBlurOnOutsidePointer(textareaRef, composerRootRef);

    const applyComposerText = useCallback(
      (next: string, options: { clearImagesAfterPrefill?: boolean } = {}) => {
        if (isControlled) {
          onChange?.(next);
        } else {
          setInternal(next);
        }
        // Programmatic prefill is not a user paste — drop any folded
        // placeholders so the next paste counter starts at #1 and
        // the registry doesn't carry stale entries.
        resetPasteRegistry();
        if (options.clearImagesAfterPrefill) clearImages();
        // Focus + caret at end on the next frame, after React has
        // committed the new textarea value. setSelectionRange before
        // the commit lands at the old text length.
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (!ta) return;
          ta.focus();
          const end = ta.value.length;
          ta.setSelectionRange(end, end);
        });
      },
      [isControlled, onChange, clearImages, resetPasteRegistry],
    );

    // Imperative API for callers that need to seed the textarea
    // without rewiring as a controlled component. Adding it via ref
    // keeps the existing paste-fold internal-state refs intact for the
    // common typing path.
    useImperativeHandle(
      ref,
      () => ({
        prefillText(next: string) {
          applyComposerText(next, { clearImagesAfterPrefill: true });
        },
        focus() {
          textareaRef.current?.focus();
        },
      }),
      [applyComposerText],
    );

    // Auto-grow: reset height to `auto` (so scrollHeight reflects
    // content, not previous height) then snap to scrollHeight. Capped
    // at COMPOSER_MAX_HEIGHT_PX — beyond that the textarea scrolls
    // internally. ChatGPT / Claude / Notion all do this pattern; users
    // expect multi-line input to expand the composer rather than
    // disappear behind a fixed-height window.
    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      const next = Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX);
      el.style.height = `${next}px`;
    }, [text]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      if (!isControlled) setInternal(next);
      if (showByTheWayRequiredHint) setShowByTheWayRequiredHint(false);
      onChange?.(next);
    };

    const resetDraftAfterSubmit = () => {
      if (isControlled) {
        onChange?.("");
      } else {
        setInternal("");
      }
      resetPasteRegistry();
      clearImages();
      // Synchronous drop: the write-through effect would clear the entry
      // on the next render, but submit can unmount this Composer first
      // (EmptyState → MainView switch) and resurrect the sent text.
      if (draftKey) dropComposerDraft(draftKey);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // Image-bearing pastes belong to useImageAttachments; if it consumed
      // the paste, stop before the text / paste-fold path below.
      if (tryAcceptPastedImages(e)) return;
      handleTextPaste(e);
    };

    // `/btw` side questions deliberately bypass the stopMode gate
    // below — they're the explicit "ask while agent is running"
    // affordance. Detection lives at this level (not at the
    // App.tsx onSubmit) so the Composer can also flip the submit
    // button back from Stop to Send when /btw is staged.
    const isSideQuestion =
      text.trimStart().startsWith("/btw ") ||
      text.trimStart() === "/btw" ||
      text.trimStart().startsWith("/btw\t");

    const hasText = text.trim().length > 0;
    const hasSendableContent = hasText || hasPendingImages;
    const canShowGoalEntry = Boolean(onGoalSubmit) && !goal;
    // Single active Goal: another Goal is already running elsewhere (this
    // Composer isn't the one showing it, since canShowGoalEntry requires !goal).
    const goalBlockedByActive = canShowGoalEntry && hasActiveGoal;
    const goalModeBlocked = disabled || stopMode || goalBlockedByActive;
    const goalEntryDisabled = goalModeBlocked || goalSubmitting;
    const goalStartBlocked = goalModeBlocked || !hasText || goalSubmitting;
    const effectiveGoalArmed =
      goalArmed && canShowGoalEntry && !goalModeBlocked && !requiresModelConfig;
    const effectiveGoalConfirmOpen = goalConfirmOpen && effectiveGoalArmed;
    const resolvedPlaceholder = effectiveGoalArmed
      ? copy.composer.goalPlaceholder
      : (placeholder ?? copy.composer.askAnything);
    const shouldShowByTheWayRequiredHint =
      showByTheWayRequiredHint && stopMode && !isSideQuestion;
    // Division of labor while the agent runs: the placeholder owns the
    // /btw lesson (it sits exactly where the prefix gets typed and is
    // itself the format example), so the persistent hint must NOT
    // repeat it — it degrades to pure status ("运行中…"). "Enter 发送"
    // would be a lie here (plain Enter is gated), EXCEPT once /btw is
    // staged: then Enter really sends again, so the true keyboard hint
    // comes back. The transient byTheWayPrefixHint stays as the
    // correction after a blocked Enter attempt.
    const keyboardHint = showFooterHint
      ? shouldShowByTheWayRequiredHint
        ? copy.composer.byTheWayPrefixHint
        : stopMode
          ? isSideQuestion
            ? copy.composer.enterHint
            : copy.composer.runningHint
          : effectiveGoalArmed
            ? // Armed changes what Enter does (opens the Goal preview, not
              // send) — with the wide "启动 Goal" pill gone, this hint and
              // the button tooltip carry that semantic.
              copy.composer.startGoalWithEnter
            : copy.composer.enterHint
      : null;
    // Keyboard hints get kbd-token styling; a caller-supplied staticHint
    // is already a ReactNode and renders as-is in the same slot.
    const footerHint: ReactNode =
      showGoalBlockedHint && goalBlockedByActive ? (
        <span className="text-warning">
          {copy.composer.goalBlockedByActive}
        </span>
      ) : keyboardHint ? (
        renderComposerHintWithKbd(keyboardHint)
      ) : (
        (staticHint ?? null)
      );

    useEffect(() => {
      if (!showByTheWayRequiredHint) return;
      const timer = window.setTimeout(() => {
        setShowByTheWayRequiredHint(false);
      }, 1600);
      return () => window.clearTimeout(timer);
    }, [showByTheWayRequiredHint]);

    useEffect(() => {
      if (!showGoalBlockedHint) return;
      // Auto-fade after long enough to read. If the blocking Goal finishes
      // first the hint stops rendering anyway (its render gate ANDs in
      // goalBlockedByActive), so no separate early-clear is needed.
      const timer = window.setTimeout(() => {
        setShowGoalBlockedHint(false);
      }, 2600);
      return () => window.clearTimeout(timer);
    }, [showGoalBlockedHint]);

    const handleGoalArmToggle = () => {
      if (!canShowGoalEntry) return;
      if (requiresModelConfig) {
        onConfigureModels?.();
        return;
      }
      // A second Goal is blocked while one is running. Don't fail silently
      // on a disabled-looking button — surface the reason inline. The hover
      // tooltip alone left "why is this greyed out?" unanswered on click.
      if (goalBlockedByActive) {
        setShowGoalBlockedHint(true);
        return;
      }
      if (goalEntryDisabled) return;
      setGoalArmed((armed) => !armed);
      requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const openGoalConfirmation = () => {
      if (hasPendingImages) {
        onImageBlocked?.("goal");
        return;
      }
      const trimmed = expandPastePlaceholders(text).trim();
      if (!trimmed || disabled) return;
      if (requiresModelConfig) {
        onConfigureModels?.();
        return;
      }
      if (goalStartBlocked) return;
      setGoalConfirmationObjective(trimmed);
      setGoalConfirmOpen(true);
    };

    const handleConfirmGoal = async (config: GoalLaunchConfig) => {
      const trimmed =
        goalConfirmationObjective || expandPastePlaceholders(text).trim();
      if (!trimmed || !onGoalSubmit || goalSubmitting) return;
      setGoalSubmitting(true);
      try {
        await onGoalSubmit(trimmed, config);
        resetDraftAfterSubmit();
        setGoalArmed(false);
        setGoalConfirmOpen(false);
        setGoalConfirmationObjective("");
      } catch {
        // App owns user-facing toast copy; keep the draft so the user can retry.
      } finally {
        setGoalSubmitting(false);
      }
    };

    const handleSubmit = () => {
      const expanded = expandPastePlaceholders(text);
      const trimmed = expanded.trim();
      if ((!trimmed && !hasPendingImages) || disabled) return;
      if (requiresModelConfig) {
        onConfigureModels?.();
        return;
      }
      // Allow /btw through stopMode; everything else stays gated.
      if (stopMode && !isSideQuestion) {
        setShowByTheWayRequiredHint(true);
        return;
      }
      if (effectiveGoalArmed) {
        if (hasPendingImages) {
          onImageBlocked?.("goal");
          return;
        }
        openGoalConfirmation();
        return;
      }
      const submittedText = trimmed || copy.composer.imageOnlyFallback;
      const accepted = onSubmit?.(submittedText, pendingImages);
      if (accepted === false) return;
      resetDraftAfterSubmit();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // IME guard: Enter confirming a pinyin candidate (or Escape
      // dismissing the candidate window) belongs to the IME — it must
      // not submit the draft or disarm Goal mode.
      if (isImeCompositionKeydown(e)) return;
      if (e.key === "Escape" && effectiveGoalArmed && !goalConfirmOpen) {
        e.preventDefault();
        setGoalArmed(false);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    };

    return (
      <>
        <div
          ref={composerRootRef}
          className={cn(
            "relative rounded-md border border-line bg-elevated px-3.5 pb-2 pt-3.5 shadow-card transition-[border-color,box-shadow] duration-(--motion-fast)",
            "focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/20",
            disabled && "opacity-60",
          )}
          // Drag handlers gate on a file drag (text / URI drags fall
          // through to the textarea default). onDragOver must preventDefault
          // or the browser treats the drop as navigation / file-open; the
          // enter/leave pair drives the drop overlay below.
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDropActive && (
            <div
              // Purely visual: pointer-events-none lets the drag events
              // reach the elements beneath, so the enter/leave counter
              // stays balanced and the drop still lands on this container.
              className={cn(
                "pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-center",
                imagesEnabled
                  ? "border-brand/60 bg-brand-soft/85 text-brand-strong"
                  : "border-line bg-surface/85 text-ink-muted",
              )}
            >
              {imagesEnabled && <Paperclip size={20} weight="bold" />}
              <span className="text-[13px] font-medium">
                {imagesEnabled
                  ? copy.composer.dropToAttach
                  : copy.composer.dropUnavailable}
              </span>
            </div>
          )}
          <textarea
            ref={textareaRef}
            rows={2}
            disabled={disabled}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={resolvedPlaceholder}
            style={{ maxHeight: COMPOSER_MAX_HEIGHT_PX }}
            // `resize-none` keeps the corner grab handle hidden — the
            // height auto-grows via the effect above, so manual resize
            // would just fight it. `overflow-y-auto` handles the rare
            // case where content exceeds the max-height cap.
            className="block w-full resize-none overflow-y-auto border-0 bg-transparent p-0 [font-size:var(--conversation-composer-size)] leading-[1.55] text-ink outline-none placeholder:text-ink-muted/50"
          />

          {/* Hidden file input backing the 📎 button. Visually absent but
              focusable for a11y; the button above triggers its click.
              `value=""` reset happens in handleFileInputChange so the same
              file can be picked twice in a row. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            onChange={handleFileInputChange}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
          />

          {pendingImages.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {pendingImages.map((image, imageIndex) => (
                <div
                  key={image.id}
                  className="group/image relative h-16 w-16 overflow-hidden rounded-md border border-line bg-surface shadow-[var(--shadow-neutral-control)]"
                >
                  <button
                    type="button"
                    aria-label={copy.conversation.previewImage}
                    tabIndex={-1}
                    onMouseDown={preventMouseFocus}
                    onClick={() => setPreviewIndex(imageIndex)}
                    className="block h-full w-full outline-none"
                  >
                    <img
                      src={image.previewUrl}
                      alt={copy.composer.pastedImage}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <TooltipLabel text={copy.composer.removeImage}>
                    <button
                      type="button"
                      aria-label={copy.composer.removeImage}
                      tabIndex={-1}
                      onMouseDown={preventMouseFocus}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeImage(image, imageIndex);
                      }}
                      className={cn(
                        "absolute right-1 top-1 flex size-5 items-center justify-center rounded-full",
                        "bg-elevated/95 text-ink shadow-[var(--shadow-neutral-control)]",
                        "opacity-0 hover:bg-hover outline-none group-hover/image:opacity-100",
                      )}
                    >
                      <X size={12} weight="bold" />
                    </button>
                  </TooltipLabel>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2">
            <LLMPill
              llmDisplayName={llmDisplayName}
              llms={llms}
              onSelectLLM={onSelectLLM}
              llmConfigHint={llmConfigHint}
              onConfigureModels={onConfigureModels}
              onOpenLLMSwitcher={onOpenLLMSwitcher}
              approvalMode={approvalMode}
              disabled={disabled || stopMode}
              stopMode={stopMode}
            />
            {goal && <GoalContextBadge goal={goal} />}

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <div className="flex shrink-0 items-center gap-0">
                <SavedPromptControl
                  currentText={text}
                  disabled={disabled}
                  onPrefill={(next) =>
                    applyComposerText(next, { clearImagesAfterPrefill: false })
                  }
                  onReturnFocus={() => {
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                />
                {imagesEnabled && (
                  <TooltipLabel text={copy.composer.attachImage}>
                    {/* aria-disabled + click no-op instead of `disabled`:
                        a disabled element swallows pointer events, so its
                        explanatory tooltip could never open (same pattern
                        as the Stop button below). */}
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={preventMouseFocus}
                      onClick={() => {
                        if (disabled || stopMode) return;
                        fileInputRef.current?.click();
                      }}
                      aria-disabled={disabled || stopMode || undefined}
                      aria-label={copy.composer.attachImage}
                      className={cn(
                        COMPOSER_TERTIARY_ICON_BUTTON,
                        (disabled || stopMode) &&
                          "cursor-not-allowed opacity-50 hover:translate-y-0 hover:bg-transparent hover:text-ink-muted active:translate-y-0 active:scale-100",
                      )}
                    >
                      <Paperclip size={17} weight="thin" />
                    </button>
                  </TooltipLabel>
                )}
              </div>
              {/* Always mounted, width-animated: conditional mounting made
                  the hint (and the submit control's circle→pill morph)
                  reflow the row in one frame, so the Goal button jumped
                  sideways under the pointer the instant it was pressed. */}
              {canShowGoalEntry && (
                <span
                  className={cn(
                    "hidden min-w-0 truncate text-[11px] font-medium text-ink-soft sm:inline",
                    "transition-[max-width,opacity,margin] duration-(--motion-base) ease-firm",
                    effectiveGoalArmed
                      ? "ml-0 max-w-[160px] opacity-100"
                      : "-ml-1.5 max-w-0 opacity-0",
                  )}
                  aria-hidden={!effectiveGoalArmed || undefined}
                >
                  {copy.composer.goalArmedHint}
                </span>
              )}
              {canShowGoalEntry && (
                <TooltipLabel
                  text={
                    goalBlockedByActive
                      ? copy.composer.goalBlockedByActive
                      : requiresModelConfig
                        ? copy.composer.configureModelBeforeSending
                        : stopMode
                          ? copy.composer.goalBlockedByRunning
                          : effectiveGoalArmed
                            ? copy.composer.cancelGoalMode
                            : copy.composer.goalTooltip
                  }
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={preventMouseFocus}
                    // handleGoalArmToggle already no-ops when blocked;
                    // aria-disabled (not `disabled`) keeps pointer events
                    // alive so the explanatory tooltip ("已有 Goal 在跑")
                    // can actually open.
                    onClick={handleGoalArmToggle}
                    aria-disabled={
                      (goalEntryDisabled && !requiresModelConfig) || undefined
                    }
                    aria-label={
                      effectiveGoalArmed
                        ? copy.composer.cancelGoalMode
                        : copy.composer.goalButton
                    }
                    className={cn(
                      effectiveGoalArmed
                        ? COMPOSER_GOAL_BUTTON_ARMED
                        : COMPOSER_GOAL_BUTTON,
                      goalEntryDisabled &&
                        !requiresModelConfig &&
                        "cursor-not-allowed opacity-50 hover:translate-y-0 hover:shadow-none active:translate-y-0 active:scale-100",
                    )}
                  >
                    {/* Armed = ×, not a second Target: the launch button
                        beside it is the (filled) Target, and two identical
                        icons left the pair unreadable. × after the
                        "Goal 模式" hint reads as "dismiss this mode". */}
                    {effectiveGoalArmed ? (
                      <X size={15} weight="bold" />
                    ) : (
                      <Target size={15} weight="thin" />
                    )}
                  </button>
                </TooltipLabel>
              )}

              {/* Fixed 32px circle in EVERY state. The armed state used to
                  morph this into a 116px "启动 Goal" pill, which shoved the
                  Goal toggle ~84px left in this right-aligned row — the
                  pointer then hovered the (often unlit) pill, so a second
                  press to cancel hit a dead control. Geometry stability
                  beats the wide-label emphasis: armed is conveyed by the
                  Target icon morph + hint + tooltip instead. */}
              <span
                key={`composer-action-${submitAckTick}`}
                className={cn(
                  "relative inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                  submitAckTick > 0 && "composer-submit-ack",
                )}
              >
                {stopMode && !isSideQuestion ? (
                  <TooltipLabel
                    text={
                      isStopping ? copy.composer.stopping : copy.composer.stop
                    }
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={preventMouseFocus}
                      onClick={() => {
                        if (isStopping) return;
                        onStop?.();
                      }}
                      aria-disabled={isStopping || undefined}
                      aria-label={
                        isStopping ? copy.composer.stopping : copy.composer.stop
                      }
                      className={cn(
                        COMPOSER_STOP_BUTTON,
                        // Resting pulse halo + no hover lift while the
                        // abort is in flight: reads as "acknowledged,
                        // locked" without going fully disabled — disabled
                        // would wipe the halo via COMPOSER_ACTION_BUTTON's
                        // disabled:shadow-none.
                        isStopping &&
                          "cursor-default shadow-[var(--shadow-composer-stop-pulse)] hover:translate-y-0",
                      )}
                    >
                      <Stop size={14} weight="fill" />
                    </button>
                  </TooltipLabel>
                ) : (
                  <TooltipLabel
                    text={
                      requiresModelConfig
                        ? copy.composer.configureModelBeforeSending
                        : effectiveGoalArmed
                          ? copy.composer.startGoalWithEnter
                          : copy.composer.sendWithEnter
                    }
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={preventMouseFocus}
                      // aria-disabled + click guard (not `disabled`) so the
                      // "发送 · Enter" / "先配置模型" tooltips still open on
                      // the unlit button — see the attach button above.
                      onClick={() => {
                        if (
                          disabled ||
                          !hasSendableContent ||
                          goalSubmitting ||
                          (requiresModelConfig && !onConfigureModels)
                        ) {
                          return;
                        }
                        handleSubmit();
                      }}
                      aria-disabled={
                        disabled ||
                        !hasSendableContent ||
                        goalSubmitting ||
                        (requiresModelConfig && !onConfigureModels) ||
                        undefined
                      }
                      aria-label={
                        requiresModelConfig
                          ? copy.composer.configureModelBeforeSending
                          : effectiveGoalArmed
                            ? copy.composer.startGoal
                            : copy.composer.send
                      }
                      className={cn(
                        requiresModelConfig
                          ? COMPOSER_CONFIG_BUTTON
                          : COMPOSER_SEND_BUTTON,
                        (disabled ||
                          !hasSendableContent ||
                          goalSubmitting ||
                          (requiresModelConfig && !onConfigureModels)) &&
                          // Empty/disabled = a quiet neutral "unlit" circle, not a
                          // faded brand fill (50% of pale apricot still read as a
                          // soft button). The brand fill then *blooms* in via the
                          // base button's color/shadow transition the moment the
                          // first character lands.
                          "cursor-not-allowed border-line bg-chrome text-ink-muted shadow-none hover:translate-y-0 hover:border-line hover:bg-chrome hover:text-ink-muted hover:shadow-none active:translate-y-0 active:scale-100",
                      )}
                    >
                      {requiresModelConfig ? (
                        <Gear size={15} weight="thin" />
                      ) : effectiveGoalArmed ? (
                        <Target size={16} weight="fill" />
                      ) : (
                        <ArrowUp size={16} weight="bold" />
                      )}
                    </button>
                  </TooltipLabel>
                )}
              </span>
            </div>
          </div>
          <GoalConfirmDialog
            key={goalConfirmationObjective || "goal-confirm-closed"}
            open={effectiveGoalConfirmOpen}
            objective={goalConfirmationObjective}
            projectName={goalProjectName}
            submitting={goalSubmitting}
            onOpenChange={(open) => {
              if (goalSubmitting) return;
              setGoalConfirmOpen(open);
              if (!open) {
                setGoalArmed(false);
                setGoalConfirmationObjective("");
              }
            }}
            onConfirm={(config) => {
              void handleConfirmGoal(config);
            }}
          />
        </div>
        {footerHint && (
          <div className="mt-1.5 text-[11px] text-ink-muted">{footerHint}</div>
        )}
        <ImagePreviewDialog
          images={previewImages}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
        />
      </>
    );
  },
);

/** Render a composer footer hint, styling known keyboard / command
 * tokens (Enter, Shift+Enter, /btw) in mono so they read as keys
 * rather than prose. The tokens are language-invariant, so one
 * splitter works across zh / en copy. */
function renderComposerHintWithKbd(text: string): ReactNode {
  return text.split(/(Shift\+Enter|Enter|\/btw)/g).map((part, i) =>
    COMPOSER_HINT_KBD.has(part) ? (
      <span key={i} className="font-mono text-ink-soft">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function GoalContextBadge({ goal }: { goal: GoalBrief }) {
  const copy = useCopy();
  const label = goalPillLabel(goal.status, copy.topbar);
  return (
    <TooltipLabel text={copy.composer.goalContextBadgeTooltip}>
      <span
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-brand/25 bg-brand-soft px-2",
          "text-[12px] font-medium text-ink-soft",
        )}
      >
        <Target size={13} weight="thin" className="text-brand-strong" />
        {label}
      </span>
    </TooltipLabel>
  );
}
