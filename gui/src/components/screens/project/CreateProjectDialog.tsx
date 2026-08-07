import * as Dialog from "@radix-ui/react-dialog";
import { FolderOpen } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { useCopy } from "@/lib/i18n";
import { pickFolder } from "@/lib/pick-folder";
import { cn } from "@/lib/utils";

export interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the validated input when the user clicks 创建. The
   * caller (App.tsx) is responsible for invoking `createProject` on
   * the store and any post-create navigation (e.g., filter into the
   * new project). Resolves after the store action completes so the
   * dialog can close synchronously. */
  onCreate: (input: {
    name: string;
    rootPath?: string;
  }) => Promise<void>;
}

/**
 * Create a new Project. Folder binding uses GA Workspace / Project Mode,
 * never process cwd.
 *
 * Sized smaller than EarlierDialog (420 vs 640) — this is a quick
 * create flow, not a browser. Esc / click-outside dismiss via Radix.
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreate,
}: CreateProjectDialogProps) {
  const copy = useCopy();
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset on open. Deferred via setTimeout so the reset doesn't
  // run synchronously inside the effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setName("");
      setRootPath("");
      setSubmitting(false);
      nameInputRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const trimmedRoot = rootPath.trim();
      await onCreate({
        name: trimmedName,
        rootPath: trimmedRoot || undefined,
      });
      onOpenChange(false);
    } catch (e) {
      console.warn("[CreateProjectDialog] onCreate failed.", e);
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={(e) => {
            // ⌘/Ctrl + Enter submits without forcing the user to
            // tab to the 创建 button. Plain Enter is reserved for
            // submitting from the name input (handled by form).
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
              {copy.projects.newProject}
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
                placeholder={copy.projects.projectName}
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

            <DialogActionRow className="mt-0 pt-1">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                {copy.common.cancel}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {copy.projects.create}
              </Button>
            </DialogActionRow>
          </form>
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
