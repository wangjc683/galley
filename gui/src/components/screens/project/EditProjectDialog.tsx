import * as Dialog from "@radix-ui/react-dialog";
import { FolderOpen, Trash, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { useCopy } from "@/lib/i18n";
import { pickFolder } from "@/lib/pick-folder";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/session";

export interface EditProjectDialogProps {
  /** Project to edit. `null` = closed. The parent owns this state so
   * right-clicking different projects can re-open with fresh data
   * without a full unmount/remount cycle. */
  project: Project | null;
  onClose: () => void;
  /** Persist project edits. Resolves after the store action completes
   * so the dialog can close synchronously. */
  onSave: (
    id: string,
    partial: { name: string; rootPath?: string },
  ) => Promise<void>;
  /** Trigger delete confirm flow. Called when the user clicks the
   * destructive "删除 Project" button; a separate AlertDialog handles
   * the confirm step (parent owns it for consistency with the
   * existing ConfirmDelete* pattern in ArchivedDialog). */
  onRequestDelete: (project: Project) => void;
}

/**
 * Edit Project. Same 420px
 * frame as CreateProjectDialog so the two read as siblings; the
 * only structural difference is the destructive "删除 Project" row
 * at the bottom (separated by a divider so a stray click doesn't
 * slip into it).
 *
 * Deleting a project unassigns its sessions (projectId → NULL) but
 * doesn't delete them. The actual delete confirm dialog is owned by
 * the parent.
 */
export function EditProjectDialog({
  project,
  onClose,
  onSave,
  onRequestDelete,
}: EditProjectDialogProps) {
  const copy = useCopy();
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!project) return;
    const t = setTimeout(() => {
      setName(project.name);
      setRootPath(project.rootPath ?? "");
      setSubmitting(false);
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [project]);

  const trimmedName = name.trim();
  const trimmedRootPath = rootPath.trim();
  const canSubmit =
    !!project &&
    trimmedName.length > 0 &&
    !submitting &&
    (trimmedName !== project.name ||
      trimmedRootPath !== (project.rootPath ?? ""));

  const handleSubmit = async () => {
    if (!project || !canSubmit) return;
    setSubmitting(true);
    try {
      await onSave(project.id, {
        name: trimmedName,
        rootPath: trimmedRootPath || undefined,
      });
      onClose();
    } catch (e) {
      console.warn("[EditProjectDialog] onSave failed.", e);
      setSubmitting(false);
    }
  };

  const isOpen = !!project;

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-elevated p-5 shadow-elevated",
            "max-w-[calc(100vw-32px)]",
          )}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-[16px] font-semibold text-ink">
              {copy.projects.editProject}
            </Dialog.Title>
            <DialogCloseButton />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
            className="mt-5 space-y-4"
          >
            <Field label={copy.projects.name} required>
              <input
                ref={nameInputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={cn(
                  "h-9 w-full rounded-sm border border-line bg-app px-3 text-[13px] text-ink",
                  "placeholder:text-ink-muted focus:border-line-strong focus:outline-none",
                )}
              />
            </Field>

            <Field label={copy.projects.workspaceFolder}>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div
                  className={cn(
                    "flex h-9 min-w-[180px] flex-[1_1_190px] items-center rounded-sm border border-line bg-app px-3",
                    rootPath
                      ? "font-mono text-[11.5px] text-ink-soft"
                      : "text-[12.5px] text-ink-muted",
                  )}
                  title={rootPath || copy.projects.workspacePlaceholder}
                >
                  <span className="truncate">
                    {rootPath || copy.projects.workspacePlaceholder}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  leadingIcon={<FolderOpen size={13} weight="thin" />}
                  onClick={() => {
                    void pickFolder(copy.projects.chooseWorkspaceFolderTitle).then(
                      (path) => {
                        if (!path) return;
                        setRootPath(path);
                      },
                    );
                  }}
                >
                  {copy.projects.chooseFolder}
                </Button>
                {rootPath && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRootPath("")}
                  >
                    {copy.projects.clearFolder}
                  </Button>
                )}
              </div>
            </Field>
          </form>

          <div className="mt-6 border-t border-line pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Button
                  variant="destructive-soft"
                  size="sm"
                  onClick={() => project && onRequestDelete(project)}
                  leadingIcon={<Trash size={12} weight="thin" />}
                >
                  {copy.projects.deleteProject}
                </Button>
                <p className="mt-2 max-w-[230px] text-[11px] leading-[1.45] text-ink-muted">
                  {copy.projects.deleteProjectHint}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" onClick={onClose}>
                  {copy.common.cancel}
                </Button>
                <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
                  {copy.common.save}
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface ConfirmDeleteProjectDialogProps {
  project: Project | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Single-layer confirm before deleting a project. Same pattern as
 * ArchivedDialog's ConfirmDeleteOne — the user already deliberated
 * by navigating into Edit and clicking destructive, so no
 * checkbox-acknowledge friction needed.
 */
export function ConfirmDeleteProjectDialog({
  project,
  onCancel,
  onConfirm,
}: ConfirmDeleteProjectDialogProps) {
  const copy = useCopy();
  return (
    <Dialog.Root
      open={!!project}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby="confirm-delete-project-desc"
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-elevated p-5 shadow-elevated",
            "max-w-[calc(100vw-32px)]",
          )}
        >
          <div className="flex items-center gap-2">
            <WarningCircle size={18} weight="bold" className="text-error" />
            <Dialog.Title className="text-[15px] font-semibold text-ink">
              {copy.projects.deleteProjectTitle(project?.name ?? "")}
            </Dialog.Title>
          </div>
          <p
            id="confirm-delete-project-desc"
            className="mt-2 text-[12.5px] leading-[1.55] text-ink-soft"
          >
            {copy.projects.deleteProjectBody}{" "}
            <span className="text-ink">{copy.projects.cannotUndo}</span>
          </p>

          <DialogActionRow>
            <Button variant="secondary" onClick={onCancel} autoFocus>
              {copy.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void onConfirm();
              }}
            >
              {copy.projects.deleteProjectAction}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
