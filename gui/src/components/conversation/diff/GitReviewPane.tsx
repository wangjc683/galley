import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowClockwise, FolderOpen, GitDiff } from "@phosphor-icons/react";
import { Button, IconButton } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
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
import { PanelNotice } from "../reading/PanelNotice";
import { ReadingPanelHeader } from "../reading/ReadingPanelHeader";
import { GitFileList } from "./GitFileList";
import { GitPatchView } from "./GitPatchView";
import { PlainFileLines } from "./PlainFileLines";

export function GitReviewPane({
  initialPath,
  onRepository,
  initialSelectedPath,
  onSelectFile,
  split,
  onSplitChange,
  close,
}: {
  initialPath?: string;
  onRepository: (root: string) => void;
  initialSelectedPath?: string;
  onSelectFile: (path: string) => void;
  split: boolean;
  onSplitChange: (split: boolean) => void;
  /** Host-supplied close control (wide pane IconButton or the dialog's
   * close button) — the pane owns the header now, so it places it. */
  close?: ReactNode;
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
  const notices: Record<string, string> = {
    binary: labels.binary,
    encoding: labels.encoding,
    too_large: labels.tooLarge,
    submodule: labels.submodule,
    conflicted: labels.conflicted,
    unsupported: labels.unsupported,
    unchanged: labels.unchanged,
  };

  // Header: repository identity + baseline in the shared shell. The
  // former "工作区改动" title row carried the least information of the
  // three stacked headers; the repository name is the real title.
  const header = (
    <ReadingPanelHeader
      title={repository ? fileName(repository.root) : labels.title}
      subtitle={
        repository
          ? repository.head
            ? labels.baseline(repository.head.slice(0, 8))
            : labels.unborn
          : labels.chooseHint
      }
      subtitleTooltip={repository?.root ?? requestedPath}
      actions={
        <>
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
            <ArrowClockwise size={16} weight="thin" />
          </IconButton>
        </>
      }
      close={close}
    />
  );

  let body: ReactNode;
  if (error !== null) {
    body = <PanelNotice kind="error">{gitReviewError(error, copy)}</PanelNotice>;
  } else if (loading) {
    body = <PanelNotice kind="loading">{labels.loading}</PanelNotice>;
  } else if (!repository) {
    body = (
      <PanelNotice kind="empty" icon={<GitDiff size={28} weight="thin" />}>
        {labels.chooseHint}
      </PanelNotice>
    );
  } else if (repository.files.length === 0) {
    body = (
      <PanelNotice kind="empty" icon={<GitDiff size={28} weight="thin" />}>
        {labels.clean}
      </PanelNotice>
    );
  } else {
    body = (
      <>
        <GitFileList
          tracked={tracked}
          untracked={untracked}
          selectedPath={selected?.path ?? null}
          onSelect={(file) => void selectFile(repository, file)}
        />
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
          <span className="min-w-0 truncate text-ui-tertiary text-ink-muted">
            {selected?.status === "untracked"
              ? labels.untrackedContent
              : labels.netChanges}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {selected?.status !== "untracked" && (
              <SegmentedControl
                size="sm"
                ariaLabel={labels.layout}
                value={split ? "split" : "unified"}
                options={[
                  { value: "unified", label: labels.unified },
                  { value: "split", label: labels.split },
                ]}
                onValueChange={(value) => onSplitChange(value === "split")}
              />
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
                <FolderOpen size={15} weight="thin" />
              </IconButton>
            )}
          </div>
        </div>
        <div
          ref={scroll}
          className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain"
          aria-busy={loadingFile}
        >
          {detailError !== null ? (
            <PanelNotice kind="error">
              {gitReviewError(detailError, copy)}
            </PanelNotice>
          ) : loadingFile ? (
            <PanelNotice kind="loading">{labels.loading}</PanelNotice>
          ) : detail?.notice ? (
            <PanelNotice kind="info">
              {notices[detail.notice] ?? labels.unsupported}
            </PanelNotice>
          ) : detail?.patch ? (
            <GitPatchView
              key={selected?.path}
              patch={detail.patch}
              split={split}
            />
          ) : detail?.content !== null && detail?.content !== undefined ? (
            detail.content === "" ? (
              <PanelNotice kind="info">{copy.localFiles.empty}</PanelNotice>
            ) : (
              <PlainFileLines content={detail.content} />
            )
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      {body}
    </div>
  );
}
