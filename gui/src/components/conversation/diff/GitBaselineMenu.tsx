import { CaretDown } from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import { formatCommitDate, type GitCommit } from "@/lib/git-review";
import { cn } from "@/lib/utils";

/**
 * Baseline picker for the Git review: "latest commit" (the default
 * worktree-vs-HEAD view) or one of the recent commits, so a review
 * survives the agent committing its work — pick the commit before the
 * session started and the panel shows everything since. Presentational:
 * the pane owns the commit list and the selection.
 */
export function GitBaselineMenu({
  commits,
  base,
  loading,
  disabled,
  onOpen,
  onSelect,
}: {
  commits: GitCommit[] | null;
  /** Full commit id, or null for HEAD. */
  base: string | null;
  loading: boolean;
  disabled?: boolean;
  /** Called when the menu opens; the pane lazily fetches `log`. */
  onOpen: () => void;
  onSelect: (base: string | null) => void;
}) {
  const copy = useCopy().gitReview;
  const current = base ? commits?.find((commit) => commit.id === base) : null;
  const label = base
    ? `${base.slice(0, 8)}${current ? ` · ${current.subject}` : ""}`
    : copy.baselineHead;
  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
    >
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={copy.chooseBaseline}
          title={copy.chooseBaseline}
          trailingIcon={<CaretDown size={12} weight="bold" />}
          className="max-w-[28ch]"
        >
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-[70] max-h-[60vh] min-w-[22rem] max-w-[34rem] overflow-y-auto rounded-md border border-line bg-elevated p-1 text-[12.5px] text-ink shadow-elevated"
        >
          <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-ui-label font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {copy.baselineMenu}
          </DropdownMenu.Label>
          <BaselineItem
            selected={base === null}
            title={copy.baselineHead}
            hint={copy.baselineHeadHint}
            onSelect={() => onSelect(null)}
          />
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Label
            title={copy.recentCommitsHint}
            className="px-2.5 pb-1 pt-1.5 text-ui-label font-semibold uppercase tracking-[0.08em] text-ink-muted"
          >
            {copy.recentCommits}
          </DropdownMenu.Label>
          {loading && commits === null ? (
            <div className="px-2.5 py-1.5 text-ink-muted">{copy.loadingCommits}</div>
          ) : !commits || commits.length === 0 ? (
            <div className="px-2.5 py-1.5 text-ink-muted">{copy.noCommits}</div>
          ) : (
            commits.map((commit) => (
              <BaselineItem
                key={commit.id}
                selected={commit.id === base}
                id={commit.id.slice(0, 8)}
                title={commit.subject}
                hint={`${commit.author} · ${formatCommitDate(commit.authoredAt)}`}
                onSelect={() => onSelect(commit.id)}
              />
            ))
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function BaselineItem({
  selected,
  id,
  title,
  hint,
  onSelect,
}: {
  selected: boolean;
  id?: string;
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      data-selected={selected ? "" : undefined}
      className={cn(
        "flex cursor-default flex-col gap-0.5 rounded-sm px-2.5 py-1.5 outline-none data-[highlighted]:bg-hover",
        selected && "bg-selected",
      )}
      onSelect={onSelect}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        {id && (
          <span className="shrink-0 font-mono text-[11px] text-ink-muted">
            {id}
          </span>
        )}
        <span className="min-w-0 truncate">{title}</span>
      </span>
      <span className="truncate text-ui-tertiary text-ink-muted">{hint}</span>
    </DropdownMenu.Item>
  );
}
