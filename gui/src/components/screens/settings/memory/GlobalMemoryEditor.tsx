import { ArrowClockwise, CircleNotch } from "@phosphor-icons/react";
import { useState } from "react";

import { SettingsDisclosureCard } from "@/components/screens/settings/settings-disclosure";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  memoryErrorId,
  memoryErrorText,
  type GlobalMemoryFile,
} from "@/lib/memory";
import { cn } from "@/lib/utils";

import { ErrorLine } from "../models/ModelPrimitives";
import type { MemoryActions } from "./memory-actions";

/**
 * One of the engine's global memory files (`global_mem.txt`,
 * `global_mem_insight.txt`): the original text, editable, saved
 * explicitly — the editor-local 保存 of the Models editors, not a sticky
 * page save. A draft keeps the revision it started from, so a save after
 * the AI wrote the file meanwhile answers `changed_on_disk`; the editor
 * then offers 重新载入 and keeps the draft until the user takes it.
 * While nothing is typed the text follows the overview.
 */
export function GlobalMemoryEditor({
  file,
  actions,
}: {
  file: GlobalMemoryFile;
  actions: MemoryActions;
}) {
  const copy = useCopy().settings.memory;
  const [open, setOpen] = useState(false);
  // null: not editing — the text is the overview's.
  const [draft, setDraft] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState(file.revision);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a save, the draft stays until the overview carries the saved
  // revision, so the box never flashes back to the old text.
  const [savedRevision, setSavedRevision] = useState<string | null>(null);

  if (savedRevision !== null && file.revision === savedRevision) {
    setSavedRevision(null);
    setDraft(null);
  }

  const text = draft ?? file.content;
  const dirty =
    draft !== null && draft !== file.content && savedRevision === null;

  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    try {
      const next = await actions.writeGlobal(file.name, draft, baseRevision);
      setSavedRevision(next);
      setBaseRevision(next);
    } catch (e) {
      if (memoryErrorId(e) === "changed_on_disk") {
        setConflict(true);
      } else {
        setError(copy.saveFailed(memoryErrorText(e)));
      }
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(null);
    setConflict(false);
    setError(null);
  };

  const reload = () => {
    discard();
    actions.reload();
  };

  return (
    <SettingsDisclosureCard
      open={open}
      onToggle={() => setOpen((value) => !value)}
      header={
        <>
          <span className="truncate font-mono text-ui-secondary text-ink">
            {file.name}
          </span>
          <span className="shrink-0 text-ui-tertiary tabular-nums text-ink-muted">
            {file.exists
              ? copy.characterCount(Array.from(file.content).length)
              : copy.globalFileMissing}
          </span>
        </>
      }
    >
      <div className="space-y-2">
        <textarea
          value={text}
          spellCheck={false}
          aria-label={file.name}
          onChange={(event) => {
            if (draft === null) setBaseRevision(file.revision);
            setDraft(event.target.value);
          }}
          rows={10}
          className={cn(
            "block w-full resize-y rounded-sm border border-line bg-elevated px-2.5 py-2",
            "font-mono text-ui-meta leading-secondary text-ink",
            "outline-none transition-[border-color,box-shadow] duration-(--motion-fast) ease-firm",
            "focus:border-brand focus:ring-2 focus:ring-brand/20",
          )}
        />
        {conflict && (
          <div className="flex flex-wrap items-center gap-3 rounded-sm border border-warning/25 bg-warning/[var(--opacity-subtle)] px-3 py-2">
            <span className="min-w-0 flex-1 text-ui-secondary leading-notice text-ink-soft">
              {copy.changedOnDisk}
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              leadingIcon={<ArrowClockwise size={13} weight="thin" />}
              onClick={reload}
            >
              {copy.reload}
            </Button>
          </div>
        )}
        {error && <ErrorLine message={error} />}
        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={discard}
            >
              {copy.discard}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!dirty || saving || conflict}
            leadingIcon={
              saving ? (
                <CircleNotch size={13} weight="thin" className="spin" />
              ) : undefined
            }
            onClick={() => void save()}
          >
            {copy.save}
          </Button>
        </div>
      </div>
    </SettingsDisclosureCard>
  );
}
