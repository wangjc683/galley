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
  type GitCommit,
  type GitReviewFile,
  type GitReviewResult,
} from "@/lib/git-review";
import { pickFolder } from "@/lib/pick-folder";
import { PanelNotice } from "../reading/PanelNotice";
import { ReadingPanelHeader } from "../reading/ReadingPanelHeader";
import { GitBaselineMenu } from "./GitBaselineMenu";
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
  initialBase,
  onBaseChange,
  close,
}: {
  initialPath?: string;
  onRepository: (root: string) => void;
  initialSelectedPath?: string;
  onSelectFile: (path: string) => void;
  split: boolean;
  onSplitChange: (split: boolean) => void;
  /** Comparison baseline the owner remembered (full commit id); undefined = HEAD. */
  initialBase?: string;
  onBaseChange: (base: string | null) => void;
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
    base: initialBase ?? null,
  }));
  const [base, setBase] = useState<string | null>(initial.base);
  // The commit list is remembered together with the HEAD it was read at:
  // when HEAD moves (the agent committed) the picker re-reads instead of
  // offering a stale log.
  const [commitLog, setCommitLog] = useState<{
    head: string | null;
    commits: GitCommit[];
  } | null>(null);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const listGeneration = useRef(0);
  const fileGeneration = useRef(0);
  const commitsGeneration = useRef(0);
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
          base: repo.base,
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
    async (
      path: string,
      ticket: number,
      previous: string | null,
      against: string | null,
    ) => {
      try {
        const repo = await reviewGit({
          action: "list",
          path,
          base: against ?? undefined,
        });
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

  const load = (path: string, refresh = false, against: string | null = base) => {
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
    void fetchRepository(path, ticket, previous, against);
  };

  useEffect(() => {
    if (initial.path)
      void fetchRepository(
        initial.path,
        ++listGeneration.current,
        initial.selected ?? null,
        initial.base,
      );
    return () => {
      listGeneration.current += 1;
      fileGeneration.current += 1;
      commitsGeneration.current += 1;
    };
  }, [initial, fetchRepository]);

  const choose = async () => {
    const generation = listGeneration.current;
    const path = await pickFolder(labels.chooseRepository);
    // A different repository has different commits: the remembered
    // baseline cannot apply, so the pick resets to HEAD.
    if (path && generation === listGeneration.current) {
      setBase(null);
      onBaseChange(null);
      setCommitLog(null);
      void load(path, false, null);
    }
  };

  // Commits are fetched when the picker opens, not with every list read:
  // most reviews never change the baseline, and the log is one more Git
  // process per refresh otherwise.
  const commits =
    commitLog && repository && commitLog.head === repository.head
      ? commitLog.commits
      : null;
  const fetchCommits = () => {
    if (!repository || commits !== null || loadingCommits) return;
    const ticket = ++commitsGeneration.current;
    const head = repository.head;
    setLoadingCommits(true);
    void reviewGit({ action: "log", path: repository.root })
      .then((result) => {
        if (ticket === commitsGeneration.current)
          setCommitLog({ head, commits: result.commits ?? [] });
      })
      .catch(() => {
        if (ticket === commitsGeneration.current)
          setCommitLog({ head, commits: [] });
      })
      .finally(() => {
        if (ticket === commitsGeneration.current) setLoadingCommits(false);
      });
  };
  const changeBase = (next: string | null) => {
    if (next === base) return;
    setBase(next);
    onBaseChange(next);
    if (repository) load(repository.root, true, next);
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
  const baseCommit =
    repository?.base && commits
      ? commits.find((commit) => commit.id === repository.base)
      : undefined;
  const header = (
    <ReadingPanelHeader
      title={repository ? fileName(repository.root) : labels.title}
      subtitle={
        repository
          ? repository.base
            ? baseCommit
              ? labels.baselineCommit(
                  repository.base.slice(0, 8),
                  baseCommit.subject,
                )
              : labels.baselineShort(repository.base.slice(0, 8))
            : repository.head
              ? labels.baseline(repository.head.slice(0, 8))
              : labels.unborn
          : labels.chooseHint
      }
      subtitleTooltip={repository?.root ?? requestedPath}
      actions={
        <>
          {repository?.head && (
            <GitBaselineMenu
              commits={commits}
              base={base}
              loading={loadingCommits}
              disabled={loading}
              onOpen={fetchCommits}
              onSelect={changeBase}
            />
          )}
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
              : repository.base
                ? labels.sinceBaseline
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
