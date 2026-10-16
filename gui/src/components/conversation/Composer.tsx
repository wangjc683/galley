import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { ComposerActionSlot } from "@/components/conversation/ComposerActionSlot";
import { ComposerAddMenu } from "@/components/conversation/ComposerAddMenu";
import { ComposerDropOverlay } from "@/components/conversation/ComposerDropOverlay";
import { ComposerFooterHint } from "@/components/conversation/ComposerFooterHint";
import { ComposerImageStrip } from "@/components/conversation/ComposerImageStrip";
import { ComposerQueueStrip } from "@/components/conversation/ComposerQueueStrip";
import { ImagePreviewDialog } from "@/components/conversation/ImagePreviewDialog";
import {
  EffortPill,
  type ComposerReasoningEffortState,
} from "@/components/conversation/EffortPill";
import {
  LLMPill,
  type ComposerLLMOption,
} from "@/components/conversation/LLMPill";
import { SavedPromptDialogs } from "@/components/conversation/SavedPromptDialogs";
import { ComposerOneLine } from "@/components/conversation/ComposerOneLine";
// TEMP variant switcher (telegram-details 05)
import { composerGrowTiming } from "@/components/conversation/td-variants/td-variants";
import {
  COMPOSER_MAX_HEIGHT_PX,
  ONE_LINE_GHOST_CLASS,
  ONE_LINE_GHOST_STYLE,
  ONE_LINE_HINT_CLASS,
  ONE_LINE_IMAGE_STRIP_CLASS,
  ONE_LINE_TEXTAREA_CLASS,
  ONE_LINE_TEXTAREA_STYLE,
  oneLineMaxHeightPx,
} from "@/components/conversation/composer-styles";
import { useComposerFocus } from "@/hooks/useComposerFocus";
import { useFileReferences } from "@/hooks/useFileReferences";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { usePasteFold } from "@/hooks/usePasteFold";
import { animateTextareaHeight } from "@/lib/composer-grow";
import type { ImageBlockReason } from "@/lib/composer-images";
import {
  dropComposerDraft,
  readComposerDraft,
  saveComposerDraft,
} from "@/lib/composer-draft";
import { useCopy } from "@/lib/i18n";
import { isImeCompositionKeydown } from "@/lib/ime";
import { findPromptFillSlot } from "@/lib/saved-prompts";
import { isSideQuestion } from "@/lib/side-question";
import { cn } from "@/lib/utils";
import { useQueueStore } from "@/stores/queue";
import { useSessionsStore } from "@/stores/sessions";

import type {
  ComposerHandle,
  ComposerProps,
} from "@/components/conversation/composer-props";

export type { ComposerLLMOption };
export type { ComposerReasoningEffortState };

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
 * position. A session (MainView) arranges the same pieces in one row
 * (`oneLine`, ComposerOneLine.tsx); the empty state keeps the card.
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
      ghostSuggestion,
      draftKey,
      llms,
      onSelectLLM,
      llmConfigHint,
      onConfigureModels,
      requiresModelConfig = false,
      onOpenLLMSwitcher,
      reasoningEffort,
      showFooterHint = false,
      staticHint,
      imagesEnabled = true,
      onImageBlocked,
      onTextDropBlocked,
      oneLine = false,
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
    const isControlled = value !== undefined;
    const text = isControlled ? value : internal;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const composerRootRef = useRef<HTMLDivElement>(null);
    // Screen-reader bridge for the ghost suggestion: the overlay is
    // aria-hidden (visual duplicate of what aria-describedby carries),
    // so AT users hear the suggestion via this sr-only description on
    // the textarea instead.
    const ghostDescId = useId();

    // File references ([File #N: name] placeholders for dropped / picked
    // non-image paths, expanded to absolute paths at submit). Declared
    // before the image hook because the drop intake below routes its
    // non-image subset here.
    const {
      insertPathReferences,
      expandFileRefPlaceholders,
      resetFileRefRegistry,
    } = useFileReferences({
      text,
      textareaRef,
      applyValue: (next) => {
        setInternal(next);
        onChange?.(next);
      },
    });

    // Image attachments (pending tiles, hidden file input, preview dialog,
    // and the paste / drop / picker intake) live in their own hook so the
    // object-URL lifetime bookkeeping doesn't tangle with the textarea.
    const {
      pendingImages,
      hasPendingImages,
      previewImages,
      previewIndex,
      setPreviewIndex,
      isDropActive,
      acceptPickedPaths,
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
      // Drop follows typing: whenever the textarea accepts input, the
      // window accepts a drop (PRD 定案 6).
      dropEnabled: !disabled,
      onNonImagePaths: (paths) => void insertPathReferences(paths),
      onTextDropBlocked,
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

    // Both placeholder families resolved: paste folds first, then file
    // references. Order doesn't matter (disjoint grammars); what matters
    // is that every submit / draft-save path goes through this single
    // helper so the two registries can't drift apart.
    const expandComposerPlaceholders = useCallback(
      (s: string) => expandFileRefPlaceholders(expandPastePlaceholders(s)),
      [expandFileRefPlaceholders, expandPastePlaceholders],
    );

    // Draft parking (write-through): every text / attachment change
    // updates the parked draft so unmount needs no save step (an
    // unmount-time save could race the image hook's URL bookkeeping).
    // Text is stored expanded — see lib/composer-draft.ts.
    useEffect(() => {
      if (!draftKey || isControlled) return;
      saveComposerDraft(draftKey, {
        text: expandComposerPlaceholders(text),
        images: pendingImages,
      });
    }, [
      draftKey,
      isControlled,
      text,
      pendingImages,
      expandComposerPlaceholders,
    ]);

    // Focus contract: an appearing composer takes the caret, window
    // activation restores it, and both yield to competing claims — see
    // lib/composer-focus.ts for the policy and the hook for the wiring.
    useComposerFocus(textareaRef, composerRootRef);

    const applyComposerText = useCallback(
      (
        next: string,
        options: {
          clearImagesAfterPrefill?: boolean;
          /** Select this range instead of parking the caret at the end
           * (a saved prompt's trailing `[…]` slot). */
          selection?: { start: number; end: number } | null;
        } = {},
      ) => {
        if (isControlled) {
          onChange?.(next);
        } else {
          setInternal(next);
        }
        // Programmatic prefill is not a user paste or drop — reset both
        // placeholder registries so counters start at #1 and no stale
        // entries linger.
        resetPasteRegistry();
        resetFileRefRegistry();
        if (options.clearImagesAfterPrefill) clearImages();
        // Focus + caret at end (or the requested selection) on the
        // next frame, after React has committed the new textarea value.
        // setSelectionRange before the commit lands at the old length.
        const selection = options.selection;
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (!ta) return;
          ta.focus();
          const end = ta.value.length;
          if (selection && selection.end <= end) {
            ta.setSelectionRange(selection.start, selection.end);
          } else {
            ta.setSelectionRange(end, end);
          }
        });
      },
      [isControlled, onChange, clearImages, resetPasteRegistry, resetFileRefRegistry],
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
    // disappear behind a fixed-height window. The one-line form caps at
    // eight lines instead.
    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      // TEMP variant switcher (telegram-details 05): A2 / A3 animate the
      // one-line input to its new height (lib/composer-grow.ts); A1,
      // today's, is the instant path below.
      const timing = oneLine ? composerGrowTiming() : "instant";
      if (animateTextareaHeight(el, timing, oneLineMaxHeightPx)) return;
      el.style.height = "auto";
      const cap = oneLine ? oneLineMaxHeightPx(el) : COMPOSER_MAX_HEIGHT_PX;
      const next = Math.min(el.scrollHeight, cap);
      el.style.height = `${next}px`;
    }, [text, oneLine]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      if (!isControlled) setInternal(next);
      onChange?.(next);
    };

    const resetDraftAfterSubmit = () => {
      if (isControlled) {
        onChange?.("");
      } else {
        setInternal("");
      }
      resetPasteRegistry();
      resetFileRefRegistry();
      clearImages();
      // Synchronous drop: the write-through effect would clear the entry
      // on the next render, but submit can unmount this Composer first
      // (EmptyState → MainView switch) and resurrect the sent text.
      if (draftKey) dropComposerDraft(draftKey);
    };

    // ＋ → "files or images…" / "folders…": native path pickers. Files
    // take the drop's split (images attach, the rest become references);
    // folders are always references. Two rows because the native panel
    // can't pick files and folders at once.
    const handlePickPaths = async (kind: "files" | "folders") => {
      try {
        const picked = await openFileDialog({
          multiple: true,
          directory: kind === "folders",
        });
        if (!picked) return;
        const paths = Array.isArray(picked) ? picked : [picked];
        if (kind === "files") {
          acceptPickedPaths(paths);
        } else {
          await insertPathReferences(paths);
        }
      } catch (err) {
        // No Tauri runtime (web-only session) or dialog failure — the
        // click simply does nothing beyond this log.
        console.warn("[Composer] file picker failed", err);
      }
    };

    const [promptsOpen, setPromptsOpen] = useState(false);
    const focusTextarea = () => {
      requestAnimationFrame(() => textareaRef.current?.focus());
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
    const sideQuestionStaged = isSideQuestion(text);

    const hasText = text.trim().length > 0;
    const hasSendableContent = hasText || hasPendingImages;

    // Outbound queue for the active session (galley#19): rendered as
    // chips above the composer box. Read directly from the stores —
    // the Composer is keyed per session, and threading these two reads
    // through every host (MainView / EmptyState) buys no reuse: the
    // empty screen has no active session and renders no strip.
    const activeSessionId = useSessionsStore((s) => s.activeSessionId);
    const queueItems = useQueueStore((s) =>
      activeSessionId ? (s.bySession[activeSessionId] ?? EMPTY_QUEUE) : EMPTY_QUEUE,
    );

    // Ghost text (next-step suggestion): a derived condition, not a
    // one-shot event — typing hides it, deleting everything brings it
    // back, IME composition (non-empty text) hides it. No dismissed
    // flag by design (.scratch/composer-next-suggestion 定案 5).
    const ghostVisible = Boolean(
      ghostSuggestion &&
        text === "" &&
        !disabled &&
        !stopMode &&
        !hasPendingImages,
    );

    const resolvedPlaceholder = ghostVisible
      ? "" // the ghost overlay occupies the placeholder's visual slot
      : (placeholder ?? copy.composer.askAnything);

    const handleSubmit = () => {
      const expanded = expandComposerPlaceholders(text);
      const trimmed = expanded.trim();
      if ((!trimmed && !hasPendingImages) || disabled) return;
      if (requiresModelConfig) {
        onConfigureModels?.();
        return;
      }
      // No stopMode gate since the message queue (galley#19/#20):
      // onSubmit's owner (useMessageSend) routes a mid-run send into
      // Core's queue. /btw keeps its immediate side-question path there
      // too; images are toast-blocked there and keep the draft.
      const submittedText = trimmed || copy.composer.imageOnlyFallback;
      const accepted = onSubmit?.(submittedText, pendingImages);
      if (accepted === false) return;
      resetDraftAfterSubmit();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // IME guard: Enter confirming a pinyin candidate (or Escape
      // dismissing the candidate window) belongs to the IME — it must
      // not submit the draft.
      if (isImeCompositionKeydown(e)) return;
      // Accept the ghost suggestion. Only reachable while the textarea
      // is empty (ghostVisible), so this never steals ArrowRight from
      // caret movement over typed text.
      if (e.key === "ArrowRight" && ghostVisible && ghostSuggestion) {
        e.preventDefault();
        applyComposerText(ghostSuggestion, { clearImagesAfterPrefill: false });
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    };

    // The pieces the card arranges below. The one-line form arranges the
    // same pieces in ComposerOneLine, with its own textarea and ghost
    // metrics (ONE_LINE_* in composer-styles.ts).
    const queueStrip = activeSessionId && (
      <ComposerQueueStrip
        sessionId={activeSessionId}
        items={queueItems}
        // One line and no hint row (the main chat's): the strip's heading
        // says what the stopping hint says in the row (ruling 71). With a
        // hint row (the workbench's) the row says it, once (ticket 27).
        heading={
          oneLine && !showFooterHint && isStopping && queueItems.length > 0
            ? copy.composer.stoppingQueueHint
            : undefined
        }
        onRefill={(t) => {
          applyComposerText(t, { clearImagesAfterPrefill: false });
          requestAnimationFrame(() => textareaRef.current?.focus());
        }}
      />
    );
    const dropOverlay = isDropActive && (
      <ComposerDropOverlay imagesEnabled={imagesEnabled} line={oneLine} />
    );
    const ghost = ghostVisible && (
      <div
        aria-hidden
        // Mirrors the textarea's box exactly (container padding +
        // font metrics) so the ghost sits where typed text would.
        // pointer-events-none keeps clicks landing in the textarea;
        // only the accept hint below opts back in.
        className={
          oneLine
            ? ONE_LINE_GHOST_CLASS
            : "pointer-events-none absolute inset-x-3.5 top-3.5 flex items-baseline gap-2 overflow-hidden [font-size:var(--conversation-composer-size)] leading-[1.55]"
        }
        style={oneLine ? ONE_LINE_GHOST_STYLE : undefined}
      >
        <span className="truncate text-ink-muted/50">{ghostSuggestion}</span>
        {/* Mouse users' accept path (keyboard has ArrowRight).
            tabIndex -1: the parent is aria-hidden, so the button
            must stay out of the tab order — AT users get the
            same action via ArrowRight, announced through the
            textarea's aria-describedby. */}
        <button
          type="button"
          tabIndex={-1}
          onClick={() =>
            ghostSuggestion &&
            applyComposerText(ghostSuggestion, {
              clearImagesAfterPrefill: false,
            })
          }
          className="pointer-events-auto shrink-0 cursor-pointer text-[11px] text-ink-muted/40 transition-colors duration-(--motion-fast) hover:text-ink-muted"
        >
          {copy.composer.ghostAcceptHint}
        </button>
      </div>
    );
    const ghostDescription = ghostVisible && ghostSuggestion && (
      <span id={ghostDescId} className="sr-only">
        {copy.composer.ghostSrDescription(ghostSuggestion)}
      </span>
    );
    const textarea = (
      <textarea
        ref={textareaRef}
        rows={oneLine ? 1 : 2}
        disabled={disabled}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={resolvedPlaceholder}
        // Ghost affordances that the overlay can't carry itself:
        // native tooltip reveals a truncated suggestion in full
        // (the overlay is pointer-events-none, so hover lands
        // here), and aria-describedby announces it to AT.
        title={ghostVisible && ghostSuggestion ? ghostSuggestion : undefined}
        aria-describedby={
          ghostVisible && ghostSuggestion ? ghostDescId : undefined
        }
        style={
          oneLine
            ? ONE_LINE_TEXTAREA_STYLE
            : { maxHeight: COMPOSER_MAX_HEIGHT_PX }
        }
        // `resize-none` keeps the corner grab handle hidden — the
        // height auto-grows via the effect above, so manual resize
        // would just fight it. `overflow-y-auto` handles the rare
        // case where content exceeds the max-height cap.
        className={
          oneLine
            ? ONE_LINE_TEXTAREA_CLASS
            : "block w-full resize-none overflow-y-auto border-0 bg-transparent p-0 [font-size:var(--conversation-composer-size)] leading-[1.55] text-ink outline-none placeholder:text-ink-muted/50"
        }
      />
    );
    const imageStrip = pendingImages.length > 0 && (
      <ComposerImageStrip
        images={pendingImages}
        onPreview={setPreviewIndex}
        onRemove={removeImage}
        className={oneLine ? ONE_LINE_IMAGE_STRIP_CLASS : undefined}
      />
    );
    const addMenu = (
      <ComposerAddMenu
        disabled={disabled}
        imagesEnabled={imagesEnabled}
        onPickFiles={() => void handlePickPaths("files")}
        onPickFolders={() => void handlePickPaths("folders")}
        onOpenPrompts={() => setPromptsOpen(true)}
        onReturnFocus={focusTextarea}
      />
    );
    // At the row's right end in the one-line form: its popovers open
    // centred on the pill they belong to (ruling 76; lined up by their
    // right edge they reached out to the left, off the pill).
    const popoverAlign = oneLine ? "center" : undefined;
    const modelPhrase = (
      <>
        <LLMPill
          llmDisplayName={llmDisplayName}
          llms={llms}
          onSelectLLM={onSelectLLM}
          llmConfigHint={llmConfigHint}
          onConfigureModels={onConfigureModels}
          onOpenLLMSwitcher={onOpenLLMSwitcher}
          disabled={disabled || stopMode}
          stopMode={stopMode}
          phraseLead={reasoningEffort !== undefined}
          popoverAlign={popoverAlign}
        />
        {reasoningEffort && (
          <>
            <span
              aria-hidden
              className="shrink-0 select-none px-0.5 text-[12.5px] text-ink-muted/60"
            >
              ·
            </span>
            <EffortPill {...reasoningEffort} popoverAlign={popoverAlign} />
          </>
        )}
      </>
    );
    const actionSlot = (
      <ComposerActionSlot
        stopMode={stopMode}
        isSideQuestion={sideQuestionStaged}
        isStopping={isStopping}
        submitAckTick={submitAckTick}
        disabled={disabled}
        hasSendableContent={hasSendableContent}
        requiresModelConfig={requiresModelConfig}
        hasConfigureModels={Boolean(onConfigureModels)}
        onStop={onStop}
        onSubmit={handleSubmit}
      />
    );

    return (
      <>
        {queueStrip}
        {oneLine ? (
          <ComposerOneLine
            rootRef={composerRootRef}
            disabled={disabled}
            dropOverlay={dropOverlay}
            imageStrip={imageStrip}
            addMenu={addMenu}
            input={
              <>
                {ghost}
                {ghostDescription}
                {textarea}
              </>
            }
            modelPhrase={modelPhrase}
            actionSlot={actionSlot}
          />
        ) : (
          <div
            ref={composerRootRef}
            className={cn(
              "relative rounded-md border border-line bg-elevated px-3.5 pb-2 pt-3.5 shadow-card transition-[border-color,box-shadow,background-color] duration-(--motion-fast) ease-firm",
              "focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/20",
              disabled && "opacity-60",
            )}
            // No HTML5 drag handlers: with dragDropEnabled true, drops
            // arrive through the native onDragDropEvent subscription inside
            // useImageAttachments; `isDropActive` below is fed from there.
          >
            {dropOverlay}
            {ghost}
            {ghostDescription}
            {textarea}
            {imageStrip}
            <div className="mt-2 flex items-center gap-2">
              {/* ＋ opens left, like the chat apps people already know:
                  the left side says what goes in and who answers, the
                  right side only how it's sent (2026-10-03). It sits
                  flush against the model phrase (no row gap): with the
                  gap, ＋ read as a stray control 31px away from the
                  model name. Files aren't gated on stopMode — a
                  reference is plain text and queues like any message,
                  same as a drop.

                  Model + effort form ONE phrase (「grok-4.7 · high」): no
                  row gap between them and no caret on either half
                  (2026-10-03). The middle dot (same day) keeps
                  the tier from reading as part of the model id — tier
                  words double as model-name suffixes (o3-mini-high). It
                  is plain text, not a target; each pill keeps its own
                  hover box. The effort pill is deliberately NOT gated on
                  `stopMode` / `disabled`: the engine reads the tier per
                  request, so dialing it mid-run is legitimate and lands
                  on the next call. */}
              <div className="flex min-w-0 items-center">
                {addMenu}
                {modelPhrase}
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {actionSlot}
              </div>
            </div>
          </div>
        )}
        <ComposerFooterHint
          showFooterHint={showFooterHint}
          stopMode={stopMode}
          isStopping={isStopping}
          hasQueuedMessages={queueItems.length > 0}
          hasText={hasText}
          isSideQuestion={sideQuestionStaged}
          staticHint={staticHint}
          className={oneLine ? ONE_LINE_HINT_CLASS : undefined}
        />
        <SavedPromptDialogs
          open={promptsOpen}
          onOpenChange={setPromptsOpen}
          currentText={text}
          disabled={disabled}
          onPrefill={(next) =>
            applyComposerText(next, {
              clearImagesAfterPrefill: false,
              selection: findPromptFillSlot(next),
            })
          }
          onReturnFocus={focusTextarea}
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

const EMPTY_QUEUE: never[] = [];
