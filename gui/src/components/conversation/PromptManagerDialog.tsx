import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CaretDown,
  Copy,
  Eye,
  PencilSimple,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Button, DialogActionRow, IconButton } from "@/components/ui/button";
import {
  createCopiedPromptTitle,
  resolveSavedPrompts,
  type PromptPreset,
  type ResolvedSavedPrompt,
} from "@/lib/saved-prompts";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useSavedPromptsStore } from "@/stores/saved-prompts";

type ManagerMode = "library" | "new" | "edit" | "preview";

const HIGHLIGHT_DURATION_MS = 1600;

export function PromptManagerDialog({
  open,
  onOpenChange,
  presets,
  onUsePrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: PromptPreset[];
  onUsePrompt: (prompt: ResolvedSavedPrompt) => void;
}) {
  const copy = useCopy();
  const promptCopy = copy.composer.savedPrompts;
  const prefs = useSavedPromptsStore((state) => state.prefs);
  const addCustomPrompt = useSavedPromptsStore((state) => state.addCustomPrompt);
  const updateCustomPrompt = useSavedPromptsStore(
    (state) => state.updateCustomPrompt,
  );
  const deleteCustomPrompt = useSavedPromptsStore(
    (state) => state.deleteCustomPrompt,
  );
  const moveCustomPrompt = useSavedPromptsStore(
    (state) => state.moveCustomPrompt,
  );

  const allPrompts = resolveSavedPrompts(presets, prefs);
  const presetPrompts = allPrompts.filter((prompt) => prompt.kind === "preset");
  const customPrompts = allPrompts.filter((prompt) => prompt.kind === "custom");

  const [mode, setMode] = useState<ManagerMode>("library");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [presetsCollapsed, setPresetsCollapsed] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const editingPrompt =
    mode === "edit"
      ? customPrompts.find((prompt) => prompt.id === editingId) ?? null
      : null;
  const previewPrompt =
    mode === "preview"
      ? allPrompts.find((prompt) => prompt.id === previewId) ?? null
      : null;

  // Auto-clear the "just added" highlight after a beat so the ring doesn't
  // linger forever. The card itself owns the scrollIntoView.
  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(
      () => setHighlightId(null),
      HIGHLIGHT_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const returnToLibrary = () => {
    setMode("library");
    setEditingId(null);
    setPreviewId(null);
  };

  const editCustomPrompt = (prompt: ResolvedSavedPrompt) => {
    if (prompt.kind !== "custom") return;
    setEditingId(prompt.id);
    setMode("edit");
  };

  const previewSavedPrompt = (prompt: ResolvedSavedPrompt) => {
    setPreviewId(prompt.id);
    setMode("preview");
  };

  const copyAsCustom = async (prompt: ResolvedSavedPrompt) => {
    const id = await addCustomPrompt({
      title: createCopiedPromptTitle(prompt.title, promptCopy.copyTitleSuffix),
      body: prompt.body,
    });
    if (id) setHighlightId(id);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) returnToLibrary();
        onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex h-[680px] w-[920px] -translate-x-1/2 -translate-y-1/2 flex-col",
            "max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-line bg-app shadow-elevated",
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-app px-6 py-3.5">
            <Dialog.Title className="truncate text-[16px] font-semibold text-ink">
              {promptCopy.managerTitle}
            </Dialog.Title>
            <div className="flex shrink-0 items-center gap-2">
              {mode === "library" && (
                <Button
                  variant="accent-secondary"
                  size="sm"
                  leadingIcon={<Plus size={12} weight="thin" />}
                  onClick={() => setMode("new")}
                >
                  {promptCopy.addCustom}
                </Button>
              )}
              <Dialog.Close asChild>
                <IconButton ariaLabel={copy.common.close} tooltip={false}>
                  <X size={14} weight="thin" />
                </IconButton>
              </Dialog.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-app px-6 py-5">
            {mode === "library" ? (
              <PromptLibrary
                presetPrompts={presetPrompts}
                customPrompts={customPrompts}
                presetsCollapsed={presetsCollapsed}
                onTogglePresetsCollapsed={() => setPresetsCollapsed((v) => !v)}
                highlightId={highlightId}
                onUsePrompt={onUsePrompt}
                onPreviewPrompt={previewSavedPrompt}
                onCopyAsCustom={copyAsCustom}
                onEditCustom={editCustomPrompt}
                onDeleteCustom={(prompt) => {
                  void deleteCustomPrompt(prompt.id);
                }}
                onMoveCustom={(prompt, direction) => {
                  void moveCustomPrompt(prompt.id, direction);
                }}
              />
            ) : mode === "preview" && previewPrompt ? (
              <PromptPreview
                prompt={previewPrompt}
                onBack={returnToLibrary}
                onUse={() => onUsePrompt(previewPrompt)}
                onCopyAsCustom={async () => {
                  await copyAsCustom(previewPrompt);
                  returnToLibrary();
                }}
                onEditCustom={() => editCustomPrompt(previewPrompt)}
              />
            ) : mode === "new" ? (
              <CustomPromptEditor
                key="new"
                mode="new"
                onCancel={returnToLibrary}
                onSave={async (input) => {
                  const id = await addCustomPrompt(input);
                  if (!id) return false;
                  returnToLibrary();
                  setHighlightId(id);
                  return true;
                }}
              />
            ) : editingPrompt ? (
              <CustomPromptEditor
                key={editingPrompt.id}
                mode="edit"
                prompt={editingPrompt}
                onCancel={returnToLibrary}
                onSave={async (input) => {
                  await updateCustomPrompt(editingPrompt.id, input);
                  returnToLibrary();
                  return true;
                }}
                onDelete={() => {
                  void deleteCustomPrompt(editingPrompt.id);
                  returnToLibrary();
                }}
              />
            ) : (
              <div className="text-[12.5px] text-ink-muted">
                {promptCopy.emptyCustom}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PromptLibrary({
  presetPrompts,
  customPrompts,
  presetsCollapsed,
  onTogglePresetsCollapsed,
  highlightId,
  onUsePrompt,
  onPreviewPrompt,
  onCopyAsCustom,
  onEditCustom,
  onDeleteCustom,
  onMoveCustom,
}: {
  presetPrompts: ResolvedSavedPrompt[];
  customPrompts: ResolvedSavedPrompt[];
  presetsCollapsed: boolean;
  onTogglePresetsCollapsed: () => void;
  highlightId: string | null;
  onUsePrompt: (prompt: ResolvedSavedPrompt) => void;
  onPreviewPrompt: (prompt: ResolvedSavedPrompt) => void;
  onCopyAsCustom: (prompt: ResolvedSavedPrompt) => void;
  onEditCustom: (prompt: ResolvedSavedPrompt) => void;
  onDeleteCustom: (prompt: ResolvedSavedPrompt) => void;
  onMoveCustom: (
    prompt: ResolvedSavedPrompt,
    direction: "up" | "down",
  ) => void;
}) {
  const copy = useCopy();
  const promptCopy = copy.composer.savedPrompts;
  return (
    <div className="space-y-5">
      <section>
        <SectionHeader
          label={promptCopy.sectionPresets}
          count={presetPrompts.length}
          collapsible
          collapsed={presetsCollapsed}
          onToggle={onTogglePresetsCollapsed}
        />
        {!presetsCollapsed && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
            {presetPrompts.map((prompt) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                highlighted={highlightId === prompt.id}
                onUse={() => onUsePrompt(prompt)}
                onPreview={() => onPreviewPrompt(prompt)}
                onCopyAsCustom={() => onCopyAsCustom(prompt)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader label={promptCopy.sectionCustom} count={customPrompts.length} />
        {customPrompts.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
            {customPrompts.map((prompt, index) => (
              <PromptCard
                key={prompt.id}
                prompt={prompt}
                highlighted={highlightId === prompt.id}
                onUse={() => onUsePrompt(prompt)}
                onPreview={() => onPreviewPrompt(prompt)}
                onEdit={() => onEditCustom(prompt)}
                onDelete={() => onDeleteCustom(prompt)}
                onMoveUp={() => onMoveCustom(prompt, "up")}
                onMoveDown={() => onMoveCustom(prompt, "down")}
                moveUpDisabled={index <= 0}
                moveDownDisabled={index >= customPrompts.length - 1}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-line bg-surface px-3 py-4 text-[12.5px] leading-relaxed text-ink-muted">
            {promptCopy.emptyCustom}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  collapsible,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const inner = (
    <>
      {collapsible && (
        <CaretDown
          size={12}
          weight="bold"
          className={cn(
            "shrink-0 text-ink-muted transition-transform duration-150",
            collapsed && "-rotate-90",
          )}
        />
      )}
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </h3>
      <span className="text-[11px] tabular-nums text-ink-muted/70">{count}</span>
      <div className="h-px flex-1 bg-line/70" />
    </>
  );
  if (!collapsible) {
    return <div className="mb-2 flex items-center gap-2">{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-2 flex w-full items-center gap-2 outline-none focus-visible:text-ink"
    >
      {inner}
    </button>
  );
}

function PromptCard({
  prompt,
  highlighted,
  onUse,
  onPreview,
  onCopyAsCustom,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  moveUpDisabled,
  moveDownDisabled,
}: {
  prompt: ResolvedSavedPrompt;
  highlighted?: boolean;
  onUse: () => void;
  onPreview: () => void;
  onCopyAsCustom?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  moveUpDisabled?: boolean;
  moveDownDisabled?: boolean;
}) {
  const copy = useCopy();
  const promptCopy = copy.composer.savedPrompts;
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!highlighted) return;
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlighted]);

  const handleAction = (
    event: MouseEvent<HTMLButtonElement>,
    action: () => void,
  ) => {
    event.stopPropagation();
    action();
  };

  return (
    <div
      ref={ref}
      onClick={onUse}
      className={cn(
        "group/card relative flex min-h-[146px] cursor-pointer flex-col rounded-md border border-line bg-surface p-3 pb-9 text-left",
        "transition-[background-color,border-color,box-shadow,transform] duration-[140ms] ease-[cubic-bezier(0.2,0,0,1)]",
        "hover:-translate-y-px hover:border-brand/35 hover:bg-elevated hover:shadow-[var(--shadow-neutral-control-hover)]",
        "active:translate-y-[1px] active:scale-[0.995]",
        highlighted && "border-brand/55 ring-2 ring-brand/40",
      )}
    >
      <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
        {prompt.title}
      </span>
      {/* Presets lead with their user-facing description (the "capability
          menu" line); the full prompt lives on the preview page. Custom
          prompts have no description, so they fall back to a body preview
          the way they always did. */}
      {prompt.description ? (
        <p className="mt-2 line-clamp-3 text-[12px] leading-[1.5] text-ink-soft">
          {prompt.description}
        </p>
      ) : (
        <p className="mt-2 line-clamp-4 text-[12px] leading-[1.45] text-ink-soft">
          {prompt.body}
        </p>
      )}
      <div
        className={cn(
          "pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 opacity-0",
          "transition-opacity duration-120 group-hover/card:pointer-events-auto group-hover/card:opacity-100",
        )}
      >
        <PromptCardIconButton
          ariaLabel={promptCopy.previewPrompt}
          onClick={(event) => handleAction(event, onPreview)}
        >
          <Eye size={12} weight="thin" />
        </PromptCardIconButton>
        {onCopyAsCustom && (
          <PromptCardIconButton
            ariaLabel={promptCopy.copyAsCustom}
            onClick={(event) => handleAction(event, onCopyAsCustom)}
          >
            <Copy size={12} weight="thin" />
          </PromptCardIconButton>
        )}
        {onEdit && (
          <PromptCardIconButton
            ariaLabel={promptCopy.editPrompt}
            onClick={(event) => handleAction(event, onEdit)}
          >
            <PencilSimple size={12} weight="thin" />
          </PromptCardIconButton>
        )}
        {onMoveUp && (
          <PromptCardIconButton
            ariaLabel={promptCopy.moveUp}
            disabled={moveUpDisabled}
            onClick={(event) => handleAction(event, onMoveUp)}
          >
            <ArrowUp size={12} weight="thin" />
          </PromptCardIconButton>
        )}
        {onMoveDown && (
          <PromptCardIconButton
            ariaLabel={promptCopy.moveDown}
            disabled={moveDownDisabled}
            onClick={(event) => handleAction(event, onMoveDown)}
          >
            <ArrowDown size={12} weight="thin" />
          </PromptCardIconButton>
        )}
        {onDelete && (
          <PromptCardIconButton
            ariaLabel={promptCopy.deleteCustom}
            variant="danger"
            onClick={(event) => handleAction(event, onDelete)}
          >
            <Trash size={12} weight="thin" />
          </PromptCardIconButton>
        )}
      </div>
    </div>
  );
}

function PromptPreview({
  prompt,
  onBack,
  onUse,
  onCopyAsCustom,
  onEditCustom,
}: {
  prompt: ResolvedSavedPrompt;
  onBack: () => void;
  onUse: () => void;
  onCopyAsCustom: () => void;
  onEditCustom: () => void;
}) {
  const copy = useCopy();
  const promptCopy = copy.composer.savedPrompts;
  const kindLabel =
    prompt.kind === "preset"
      ? promptCopy.presetPrompt
      : promptCopy.customPrompt;

  return (
    <div className="mx-auto flex min-h-full max-w-[760px] flex-col">
      <div>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<ArrowLeft size={12} weight="thin" />}
          onClick={onBack}
        >
          {promptCopy.backToLibrary}
        </Button>
      </div>

      <div className="mt-4">
        <h3 className="text-[17px] font-semibold text-ink">{prompt.title}</h3>
        {prompt.description && (
          <p className="mt-1.5 text-[13px] leading-[1.5] text-ink-soft">
            {prompt.description}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PromptMetaChip>{kindLabel}</PromptMetaChip>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-line bg-surface p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {promptCopy.fullPrompt}
        </div>
        <div className="mt-3 whitespace-pre-wrap text-[13px] leading-[1.65] text-ink">
          {prompt.body}
        </div>
      </div>

      <DialogActionRow align="between" className="mt-auto pt-5">
        <div>
          {prompt.kind === "preset" ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Copy size={12} weight="thin" />}
              onClick={onCopyAsCustom}
            >
              {promptCopy.copyAsCustom}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<PencilSimple size={12} weight="thin" />}
              onClick={onEditCustom}
            >
              {promptCopy.editPrompt}
            </Button>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={onUse}>
          {promptCopy.usePrompt}
        </Button>
      </DialogActionRow>
    </div>
  );
}

function PromptCardIconButton({
  ariaLabel,
  children,
  active = false,
  disabled = false,
  variant = "secondary",
  onClick,
}: {
  ariaLabel: string;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  variant?: "secondary" | "danger";
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <IconButton
      ariaLabel={ariaLabel}
      tooltip={ariaLabel}
      size="xs"
      variant={variant}
      active={active}
      disabled={disabled}
      onClick={onClick}
      tabIndex={-1}
      className="bg-elevated/95"
    >
      {children}
    </IconButton>
  );
}

function PromptMetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm border border-line/70 bg-app px-1.5 py-0.5 text-[10.5px] leading-none text-ink-muted">
      {children}
    </span>
  );
}

function CustomPromptEditor({
  mode,
  prompt,
  onSave,
  onCancel,
  onDelete,
}: {
  mode: "new" | "edit";
  prompt?: ResolvedSavedPrompt;
  onSave?: (input: { title: string; body: string }) => Promise<boolean | void>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const copy = useCopy();
  const promptCopy = copy.composer.savedPrompts;
  const [title, setTitle] = useState(prompt?.title ?? "");
  const [body, setBody] = useState(prompt?.body ?? "");
  const [submitting, setSubmitting] = useState(false);
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const canSave = trimmedTitle.length > 0 && trimmedBody.length > 0;

  const save = async () => {
    if (!canSave || submitting || !onSave) return;
    setSubmitting(true);
    try {
      await onSave({ title, body });
      setSubmitting(false);
    } catch (e) {
      console.warn("[PromptManagerDialog] save prompt failed.", e);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[640px]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {mode === "new" ? promptCopy.addCustom : promptCopy.editPrompt}
          </div>
          <h3 className="mt-1 text-[15px] font-semibold text-ink">
            {mode === "new" ? promptCopy.newPrompt : promptCopy.customPrompt}
          </h3>
        </div>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {copy.common.cancel}
        </Button>
      </div>
      <div className="mt-5 space-y-3">
        <Field label={promptCopy.titleLabel}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={promptCopy.titlePlaceholder}
            className={cn(
              "h-9 w-full rounded-sm border border-line bg-surface px-3 text-[13px] text-ink",
              "placeholder:text-ink-muted focus:border-line-strong focus:outline-none",
            )}
          />
        </Field>
        <Field label={promptCopy.bodyLabel}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={promptCopy.bodyPlaceholder}
            className={cn(
              "h-72 w-full resize-none rounded-sm border border-line bg-surface px-3 py-2 text-[13px] leading-[1.55] text-ink",
              "placeholder:text-ink-muted focus:border-line-strong focus:outline-none",
            )}
          />
        </Field>
      </div>
      <DialogActionRow align="between">
        <div>
          {mode === "edit" && (
            <Button
              variant="destructive-soft"
              size="sm"
              leadingIcon={<Trash size={12} weight="thin" />}
              onClick={onDelete}
            >
              {promptCopy.deleteCustom}
            </Button>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={!canSave || submitting}
          leadingIcon={<PencilSimple size={12} weight="thin" />}
          onClick={save}
        >
          {mode === "new" ? promptCopy.createPrompt : promptCopy.savePrompt}
        </Button>
      </DialogActionRow>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
