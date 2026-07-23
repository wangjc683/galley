import { Target } from "@phosphor-icons/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { ComposerActionSlot } from "@/components/conversation/ComposerActionSlot";
import { ComposerAttachButton } from "@/components/conversation/ComposerAttachButton";
import { ComposerDropOverlay } from "@/components/conversation/ComposerDropOverlay";
import { ComposerFooterHint } from "@/components/conversation/ComposerFooterHint";
import { ComposerGoalControls } from "@/components/conversation/ComposerGoalControls";
import { ComposerImageStrip } from "@/components/conversation/ComposerImageStrip";
import { ImagePreviewDialog } from "@/components/conversation/ImagePreviewDialog";
import {
  LLMPill,
  type ComposerApprovalModeState,
  type ComposerLLMOption,
} from "@/components/conversation/LLMPill";
import { SavedPromptControl } from "@/components/conversation/SavedPromptControl";
import { COMPOSER_MAX_HEIGHT_PX } from "@/components/conversation/composer-styles";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useComposerFocus } from "@/hooks/useComposerFocus";
import { useComposerGoal } from "@/hooks/useComposerGoal";
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
import { cn } from "@/lib/utils";
import type { GoalBrief } from "@/types/goal";

import type {
  ComposerHandle,
  ComposerProps,
} from "@/components/conversation/composer-props";

export type { ComposerLLMOption };
export type { ComposerApprovalModeState };

// Re-exported so callers wiring `onImageBlocked` keep importing the
// block-reason contract from the Composer; the type itself now lives with
// the image helpers in `@/lib/composer-images`.
export type { ImageBlockReason };

// The public prop / handle contracts live in composer-props.ts; re-exported
// here so callers keep importing them from the Composer.
export type { ComposerHandle, ComposerProps };

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
    const [showByTheWayRequiredHint, setShowByTheWayRequiredHint] =
      useState(false);
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

    // Focus contract: an appearing composer takes the caret, window
    // activation restores it, and both yield to competing claims — see
    // lib/composer-focus.ts for the policy and the hook for the wiring.
    useComposerFocus(textareaRef, composerRootRef);

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

    const {
      canShowGoalEntry,
      goalBlockedByActive,
      goalEntryDisabled,
      goalSubmitting,
      effectiveGoalArmed,
      effectiveGoalConfirmOpen,
      goalConfirmationObjective,
      goalBlockedHintVisible,
      handleGoalArmToggle,
      openGoalConfirmation,
      handleConfirmGoal,
      handleGoalDialogOpenChange,
      disarmGoal,
    } = useComposerGoal({
      onGoalSubmit,
      goal,
      hasActiveGoal,
      disabled,
      stopMode,
      requiresModelConfig,
      onConfigureModels,
      hasText,
      hasPendingImages,
      onImageBlocked,
      getSubmittableText: () => expandPastePlaceholders(text).trim(),
      resetDraftAfterSubmit,
      focusTextarea: () => {
        requestAnimationFrame(() => textareaRef.current?.focus());
      },
    });

    const resolvedPlaceholder = effectiveGoalArmed
      ? copy.composer.goalPlaceholder
      : (placeholder ?? copy.composer.askAnything);

    useEffect(() => {
      if (!showByTheWayRequiredHint) return;
      const timer = window.setTimeout(() => {
        setShowByTheWayRequiredHint(false);
      }, 1600);
      return () => window.clearTimeout(timer);
    }, [showByTheWayRequiredHint]);

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
      if (e.key === "Escape" && effectiveGoalArmed && !effectiveGoalConfirmOpen) {
        e.preventDefault();
        disarmGoal();
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
          {isDropActive && <ComposerDropOverlay imagesEnabled={imagesEnabled} />}
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
            <ComposerImageStrip
              images={pendingImages}
              onPreview={setPreviewIndex}
              onRemove={removeImage}
            />
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
                  <ComposerAttachButton
                    disabled={disabled || stopMode}
                    onPick={() => fileInputRef.current?.click()}
                  />
                )}
              </div>
              <ComposerGoalControls
                canShowGoalEntry={canShowGoalEntry}
                effectiveGoalArmed={effectiveGoalArmed}
                effectiveGoalConfirmOpen={effectiveGoalConfirmOpen}
                goalBlockedByActive={goalBlockedByActive}
                goalEntryDisabled={goalEntryDisabled}
                goalSubmitting={goalSubmitting}
                requiresModelConfig={requiresModelConfig}
                stopMode={stopMode}
                goalConfirmationObjective={goalConfirmationObjective}
                goalProjectName={goalProjectName}
                onArmToggle={handleGoalArmToggle}
                onDialogOpenChange={handleGoalDialogOpenChange}
                onConfirm={handleConfirmGoal}
              />
              <ComposerActionSlot
                stopMode={stopMode}
                isSideQuestion={isSideQuestion}
                isStopping={isStopping}
                submitAckTick={submitAckTick}
                disabled={disabled}
                hasSendableContent={hasSendableContent}
                goalSubmitting={goalSubmitting}
                effectiveGoalArmed={effectiveGoalArmed}
                requiresModelConfig={requiresModelConfig}
                hasConfigureModels={Boolean(onConfigureModels)}
                onStop={onStop}
                onSubmit={handleSubmit}
              />
            </div>
          </div>
        </div>
        <ComposerFooterHint
          showFooterHint={showFooterHint}
          stopMode={stopMode}
          isSideQuestion={isSideQuestion}
          showByTheWayRequiredHint={showByTheWayRequiredHint}
          effectiveGoalArmed={effectiveGoalArmed}
          goalBlockedHintVisible={goalBlockedHintVisible}
          staticHint={staticHint}
        />
        <ImagePreviewDialog
          images={previewImages}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
        />
      </>
    );
  },
);

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
