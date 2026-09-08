import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise, FolderOpen, GitDiff } from "@phosphor-icons/react";
import { Button, IconButton } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { fileName } from "@/lib/local-file-path";
import { fileOperation } from "@/lib/local-files";
import {
  gitReviewError,
  reviewGit,
  type GitReviewFile,
  type GitReviewResult,
} from "@/lib/git-review";
import { pickFolder } from "@/lib/pick-folder";
import { GitPatchView } from "./GitPatchView";

export function GitReviewPane({
  initialPath,
  onRepository,
  initialSelectedPath,
  onSelectFile,
  split,
  onSplitChange,
}: {
  initialPath?: string;
  onRepository: (root: string) => void;
  initialSelectedPath?: string;
  onSelectFile: (path: string) => void;
  split: boolean;
  onSplitChange: (split: boolean) => void;
}) {
  const copy = useCopy();
  const labels = copy.gitReview;
  const [repository, setRepository] = useState<GitReviewResult | null>(null);
  const [selected, setSelected] = useState<GitReviewFile | null>(null);
  const [detail, setDetail] = useState<GitReviewResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [loading, setLoading] = useState(Boolean(initialPath));
  const [requestedPath, setRequestedPath] = useState(initialPath);
  const [loadingFile, setLoadingFile] = useState(false);
  // The owner retains selection across wide/dialog host changes. Capture it
  // only on mount so ordinary selections do not restart repository reads.
  const [initial] = useState(() => ({
    path: initialPath,
    selected: initialSelectedPath,
  }));
  const listGeneration = useRef(0);
  const fileGeneration = useRef(0);
  const selectedPath = useRef<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);

  const selectFile = useCallback(
    async (repo: GitReviewResult, file: GitReviewFile) => {
      const ticket = ++fileGeneration.current;
      selectedPath.current = file.path;
      onSelectFile(file.path);
      setSelected(file);
      setDetail(null);
      setDetailError(null);
      setLoadingFile(true);
      if (scroll.current) scroll.current.scrollTop = 0;
      try {
        const result = await reviewGit({
          action: "diff",
          path: repo.root,
          head: repo.head,
          filePath: file.path,
        });
        if (ticket === fileGeneration.current) setDetail(result);
      } catch (failure) {
        if (ticket === fileGeneration.current) setDetailError(failure);
      } finally {
        if (ticket === fileGeneration.current) setLoadingFile(false);
      }
    },
    [onSelectFile],
  );

  const fetchRepository = useCallback(
    async (path: string, ticket: number, previous: string | null) => {
      try {
        const repo = await reviewGit({ action: "list", path });
        if (ticket !== listGeneration.current) return;
        setRepository(repo);
        onRepository(repo.root);
        const file =
          repo.files.find((entry) => entry.path === previous) ?? repo.files[0];
        if (file) void selectFile(repo, file);
      } catch (failure) {
        if (ticket === listGeneration.current) setError(failure);
      } finally {
        if (ticket === listGeneration.current) setLoading(false);
      }
    },
    [onRepository, selectFile],
  );

  const load = (path: string, refresh = false) => {
    const ticket = ++listGeneration.current;
    fileGeneration.current += 1;
    const previous = refresh ? selectedPath.current : null;
    setRequestedPath(path);
    setLoading(true);
    setError(null);
    setDetailError(null);
    setDetail(null);
    setSelected(null);
    setLoadingFile(false);
    setRepository(null);
    void fetchRepository(path, ticket, previous);
  };

  useEffect(() => {
    if (initial.path)
      void fetchRepository(
        initial.path,
        ++listGeneration.current,
        initial.selected ?? null,
      );
    return () => {
      listGeneration.current += 1;
      fileGeneration.current += 1;
    };
  }, [initial, fetchRepository]);

  const choose = async () => {
    const generation = listGeneration.current;
    const path = await pickFolder(labels.chooseRepository);
    if (path && generation === listGeneration.current) void load(path);
  };
  const tracked =
    repository?.files.filter((file) => file.status !== "untracked") ?? [];
  const untracked =
    repository?.files.filter((file) => file.status === "untracked") ?? [];
  const groups = [
    { label: labels.tracked, files: tracked },
    { label: labels.untracked, files: untracked },
  ];
  const notices: Record<string, string> = {
    binary: labels.binary,
    encoding: labels.encoding,
    too_large: labels.tooLarge,
    submodule: labels.submodule,
    conflicted: labels.conflicted,
    unsupported: labels.unsupported,
    unchanged: labels.unchanged,
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <TooltipLabel
            text={repository?.root ?? requestedPath ?? labels.chooseHint}
          >
            <p className="truncate text-sm font-medium text-ink">
              {repository ? fileName(repository.root) : labels.repository}
            </p>
          </TooltipLabel>
          <p className="mt-1 text-xs text-ink-muted">
            {repository
              ? repository.head
                ? labels.baseline(repository.head.slice(0, 8))
                : labels.unborn
              : labels.chooseHint}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void choose()}>
          {repository ? labels.changeRepository : labels.chooseRepository}
        </Button>
        <IconButton
          ariaLabel={copy.localFiles.refresh}
          disabled={loading || !requestedPath}
          onClick={() => {
            if (requestedPath) load(repository?.root ?? requestedPath, true);
          }}
        >
          <ArrowClockwise size={16} />
        </IconButton>
      </div>
      {error !== null ? (
        <p role="alert" className="p-4 text-sm text-ink-soft">
          {gitReviewError(error, copy)}
        </p>
      ) : loading ? (
        <p role="status" className="p-4 text-sm text-ink-muted">
          {labels.loading}
        </p>
      ) : !repository ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-ink-muted">
          <GitDiff size={28} weight="thin" />
          <p>{labels.chooseHint}</p>
        </div>
      ) : repository.files.length === 0 ? (
        <p className="p-6 text-sm text-ink-muted">{labels.clean}</p>
      ) : (
        <>
          <div className="border-b border-line p-3">
            <label
              title={labels.untrackedHint}
              className="mb-2 block text-xs text-ink-muted"
              htmlFor="git-review-file"
            >
              {labels.files(tracked.length, untracked.length)}
            </label>
            <select
              id="git-review-file"
              aria-label={labels.selectFile}
              className="w-full min-w-0 rounded-sm border border-line bg-surface px-2 py-2 font-mono text-xs text-ink outline-none focus-visible:ring-1 focus-visible:ring-brand"
              value={selected?.path ?? ""}
              onChange={(event) => {
                const file = repository.files.find(
                  (entry) => entry.path === event.target.value,
                );
                if (file) void selectFile(repository, file);
              }}
            >
              {groups.map(
                ({ label, files }) =>
                  files.length > 0 && (
                    <optgroup key={label} label={label}>
                      {files.map((file) => (
                        <option key={file.path} value={file.path}>
                          {labels.status[file.status]} · {file.path}
                        </option>
                      ))}
                    </optgroup>
                  ),
              )}
            </select>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-ink-muted">
                {selected?.status === "untracked"
                  ? labels.untrackedContent
                  : labels.netChanges}
              </span>
              <div className="flex items-center gap-1">
                {selected?.status !== "untracked" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-pressed={split}
                    onClick={() => onSplitChange(!split)}
                  >
                    {split ? labels.unified : labels.split}
                  </Button>
                )}
                {selected && selected.status !== "deleted" && (
                  <IconButton
                    ariaLabel={copy.localFiles.locate}
                    className="file-reveal-button"
                    onClick={() =>
                      void fileOperation(
                        `${repository.root}/${selected.path}`,
                        "reveal",
                        copy,
                      )
                    }
                  >
                    <FolderOpen size={15} />
                  </IconButton>
                )}
              </div>
            </div>
          </div>
          <div
            ref={scroll}
            className="min-h-0 flex-1 overflow-auto overscroll-contain"
            aria-busy={loadingFile}
          >
            {detailError !== null ? (
              <p role="alert" className="p-4 text-sm text-ink-soft">
                {gitReviewError(detailError, copy)}
              </p>
            ) : loadingFile ? (
              <p role="status" className="p-4 text-sm text-ink-muted">
                {labels.loading}
              </p>
            ) : detail?.notice ? (
              <p className="p-4 text-sm text-ink-soft">
                {notices[detail.notice] ?? labels.unsupported}
              </p>
            ) : detail?.patch ? (
              <GitPatchView
                key={selected?.path}
                patch={detail.patch}
                split={split}
              />
            ) : detail?.content !== null && detail?.content !== undefined ? (
              <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-ink">
                {detail.content || copy.localFiles.empty}
              </pre>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
