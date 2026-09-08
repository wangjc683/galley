import {
  ArrowClockwise,
  DotsThree,
  FolderOpen,
  X,
} from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  useGroupRef,
} from "react-resizable-panels";
import {
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  lazy,
  Suspense,
} from "react";
import { IconButton } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { MarkdownView } from "@/components/conversation/MarkdownView";
import {
  conversationTypographyStyle,
  type ConversationFontSize,
} from "@/lib/conversation-font-size";
import { useCopy } from "@/lib/i18n";
import { fileName, isMarkdownPath } from "@/lib/local-file-path";
import { GitReviewContext } from "@/lib/git-review";
import {
  LocalFilesContext,
  accessLocalFile,
  fileOperation,
  localFileError,
  reportFileError,
} from "@/lib/local-files";

interface Preview {
  sessionId?: string;
  path: string;
  content: string | null;
  error: unknown | null;
}

const GitReviewPane = lazy(() =>
  import("./diff/GitReviewPane").then((module) => ({
    default: module.GitReviewPane,
  })),
);

const CONVERSATION_PANEL = "file-preview-conversation";
const DOCUMENT_PANEL = "file-preview-document";
const SOLO_PANELS = [CONVERSATION_PANEL];
const SPLIT_PANELS = [CONVERSATION_PANEL, DOCUMENT_PANEL];
const DEFAULT_PREVIEW_LAYOUT = {
  [CONVERSATION_PANEL]: 54,
  [DOCUMENT_PANEL]: 46,
};

/** Window-owned Git review; Markdown reads remain scoped to their session. */
export function LocalFileWorkspace({
  children,
  fontSize = "standard",
  header: mainHeader,
  repositoryHint,
  sessionId,
}: {
  children: ReactNode;
  fontSize?: ConversationFontSize;
  header?: ReactNode;
  repositoryHint?: string;
  sessionId?: string;
}) {
  const copy = useCopy();
  const [documentPreview, setPreview] = useState<Preview | null>(null);
  const [documentSession, setDocumentSession] = useState(sessionId);
  if (documentSession !== sessionId) {
    setDocumentSession(sessionId);
    setPreview(null);
  }
  const preview =
    documentPreview?.sessionId === sessionId ? documentPreview : null;
  const [review, setReview] = useState<{
    path?: string;
    id: number;
    selectedPath?: string;
    split: boolean;
  } | null>(null);
  const repository = useRef<string | undefined>(undefined);
  const rememberRepository = useCallback((root: string) => {
    repository.current = root;
    setReview((current) => (current ? { ...current, path: root } : null));
  }, []);
  const rememberFile = useCallback((selectedPath: string) => {
    setReview((current) => (current ? { ...current, selectedPath } : null));
  }, []);
  const changeDiffLayout = useCallback((split: boolean) => {
    setReview((current) => (current ? { ...current, split } : null));
  }, []);
  const [wide, setWide] = useState(false);
  const panelOpen = preview !== null || review !== null;
  const split = wide && panelOpen;
  const groupRef = useGroupRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "galley-file-preview-layout-v1",
    // Separate single-panel and split entries prevent closing the preview
    // from replacing the saved reading split with a 100% conversation.
    panelIds: split ? SPLIT_PANELS : SOLO_PANELS,
  });
  const container = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const currentPath = useRef<string | null>(null);
  const generation = useRef(0);
  const scroll = useRef(0);

  useLayoutEffect(() => {
    // Session changes invalidate document reads without closing/reloading Git.
    generation.current += 1;
    currentPath.current = null;
    scroll.current = 0;
  }, [sessionId]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWide(entry.contentRect.width >= 1080),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const previewPath = preview?.path;
  const reviewId = review?.id;
  useEffect(() => {
    if (wide && (previewPath || reviewId))
      pane.current?.focus({ preventScroll: true });
  }, [wide, previewPath, reviewId]);

  const close = useCallback(() => {
    const ticket = ++generation.current;
    currentPath.current = null;
    setPreview(null);
    setReview(null);
    const source = origin.current;
    requestAnimationFrame(() => {
      if (generation.current === ticket && source?.isConnected)
        source.focus({ preventScroll: true });
    });
  }, []);

  const openReview = useCallback(
    (path?: string, source?: HTMLElement) => {
      generation.current += 1;
      currentPath.current = null;
      if (source && !pane.current?.contains(source)) origin.current = source;
      setPreview(null);
      setReview({
        path: path ?? repository.current ?? repositoryHint,
        id: generation.current,
        split: false,
      });
    },
    [repositoryHint],
  );

  const reviewOpen = review !== null;
  const reviewControl = useMemo(
    () => ({
      isOpen: reviewOpen,
      toggle: (source: HTMLElement) => {
        if (reviewOpen) {
          origin.current = source;
          close();
        } else {
          openReview(undefined, source);
        }
      },
    }),
    [reviewOpen, close, openReview],
  );

  const load = useCallback(
    async (path: string, source?: HTMLElement, refresh = false) => {
      if (!refresh && currentPath.current === path) {
        pane.current?.focus({ preventScroll: true });
        return;
      }
      if (!isMarkdownPath(path)) {
        // A folder click must not cancel an unrelated document's pending read.
        const lifetime = generation.current;
        try {
          const file = await accessLocalFile(path, "inspect");
          if (lifetime === generation.current)
            await fileOperation(file.path, "reveal", copy);
        } catch (error) {
          if (lifetime === generation.current) reportFileError(error, copy);
        }
        return;
      }
      const ticket = ++generation.current;
      if (source && !pane.current?.contains(source)) origin.current = source;
      currentPath.current = path;
      setReview(null);
      if (!refresh) scroll.current = 0;
      setPreview({ sessionId, path, content: null, error: null });
      try {
        const file = await accessLocalFile(path, "inspect");
        if (ticket !== generation.current) return;
        if (file.kind !== "markdown") {
          close();
          await fileOperation(file.path, "reveal", copy);
          return;
        }
        const document = await accessLocalFile(file.path, "read");
        if (ticket !== generation.current) return;
        setPreview({
          sessionId,
          path: document.path,
          content: document.content,
          error: null,
        });
      } catch (error) {
        if (ticket !== generation.current) return;
        setPreview({ sessionId, path, content: null, error });
      }
    },
    [close, copy, sessionId],
  );
  const activate = useCallback(
    (path: string, source: HTMLElement) => {
      void load(path, source);
    },
    [load],
  );

  const header = preview && (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium text-ink">
          {fileName(preview.path)}
        </span>
        <TooltipLabel text={preview.path}>
          <span className="truncate font-mono text-[11px] text-ink-muted">
            {preview.path}
          </span>
        </TooltipLabel>
      </div>
      <IconButton
        ariaLabel={copy.localFiles.locate}
        className="file-reveal-button"
        onClick={() => void fileOperation(preview.path, "reveal", copy)}
      >
        <FolderOpen size={16} weight="thin" />
      </IconButton>
      <IconButton
        ariaLabel={copy.localFiles.refresh}
        disabled={preview.content === null && preview.error === null}
        onClick={() =>
          void load(currentPath.current ?? preview.path, undefined, true)
        }
      >
        <ArrowClockwise size={16} weight="thin" />
      </IconButton>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton ariaLabel={copy.common.more}>
            <DotsThree size={18} />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="z-[70] min-w-40 rounded-md border border-line bg-elevated p-1 text-[12.5px] text-ink shadow-elevated"
            align="end"
          >
            <DropdownMenu.Item
              className="cursor-default rounded-sm px-2.5 py-1.5 outline-none data-[highlighted]:bg-hover"
              onSelect={() => openReview(preview.path)}
            >
              {copy.gitReview.fromFile}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="cursor-default rounded-sm px-2.5 py-1.5 outline-none data-[highlighted]:bg-hover"
              onSelect={() => void fileOperation(preview.path, "copy", copy)}
            >
              {copy.localFiles.copyPath}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="cursor-default rounded-sm px-2.5 py-1.5 outline-none data-[highlighted]:bg-hover"
              onSelect={() => void fileOperation(preview.path, "open", copy)}
            >
              {copy.localFiles.openDefault}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
  const body = review ? (
    <Suspense
      fallback={
        <p role="status" className="p-4 text-sm text-ink-muted">
          {copy.gitReview.loading}
        </p>
      }
    >
      <GitReviewPane
        key={review.id}
        initialPath={review.path}
        onRepository={rememberRepository}
        initialSelectedPath={review.selectedPath}
        onSelectFile={rememberFile}
        split={review.split}
        onSplitChange={changeDiffLayout}
      />
    </Suspense>
  ) : (
    preview && (
      <div
        ref={(element) => {
          if (element) element.scrollTop = scroll.current;
        }}
        onScroll={(event) => {
          scroll.current = event.currentTarget.scrollTop;
        }}
        className="min-h-0 flex-1 overflow-auto overscroll-contain px-6 py-5"
        style={conversationTypographyStyle(fontSize)}
        aria-busy={preview.content === null && preview.error === null}
      >
        <p className="mb-5 font-sans text-xs text-ink-muted">
          {copy.localFiles.diskContent}
        </p>
        {preview.error !== null ? (
          <p role="alert" className="text-sm text-ink-soft">
            {localFileError(preview.error, copy)}
          </p>
        ) : preview.content === null ? (
          <p role="status" className="text-sm text-ink-muted">
            {copy.localFiles.loading}
          </p>
        ) : preview.content === "" ? (
          <p className="text-sm text-ink-muted">{copy.localFiles.empty}</p>
        ) : (
          <MarkdownView
            source={preview.content}
            variant="agent"
            documentPath={preview.path}
            className="document-preview-content"
          />
        )}
      </div>
    )
  );

  return (
    <LocalFilesContext.Provider value={activate}>
      <GitReviewContext.Provider value={reviewControl}>
        {mainHeader}
        <div
          ref={container}
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          <Group
            id="galley-file-preview"
            groupRef={groupRef}
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
            className="min-h-0 min-w-0 flex-1"
          >
            <Panel
              id={CONVERSATION_PANEL}
              defaultSize={split ? "54%" : "100%"}
              minSize={split ? "480px" : 0}
            >
              <div className="flex h-full min-h-0 min-w-0 flex-col">
                {children}
              </div>
            </Panel>
            {split && (
              <PreviewResizeSeparator
                onReset={() => {
                  groupRef.current?.setLayout(DEFAULT_PREVIEW_LAYOUT);
                }}
              />
            )}
            {panelOpen &&
              (wide ? (
                <Panel id={DOCUMENT_PANEL} defaultSize="46%" minSize="420px">
                  <div
                    ref={pane}
                    tabIndex={-1}
                    role="region"
                    aria-label={
                      review ? copy.gitReview.title : copy.localFiles.preview
                    }
                    className="flex h-full min-w-0 flex-col bg-app outline-none"
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !event.defaultPrevented) {
                        event.stopPropagation();
                        close();
                      }
                    }}
                  >
                    <div className="flex items-start gap-1 border-b border-line p-4">
                      {review ? (
                        <span className="flex-1 text-sm font-medium text-ink">
                          {copy.gitReview.title}
                        </span>
                      ) : (
                        header
                      )}
                      <IconButton
                        ariaLabel={copy.common.close}
                        tooltip={false}
                        onClick={close}
                      >
                        <X size={14} weight="thin" />
                      </IconButton>
                    </div>
                    {body}
                  </div>
                </Panel>
              ) : (
                <Dialog.Root
                  open
                  onOpenChange={(open) => {
                    if (!open) close();
                  }}
                >
                  <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
                    <Dialog.Content
                      ref={pane}
                      className="fixed left-1/2 top-1/2 z-50 flex h-[82vh] max-h-[680px] w-[calc(100vw-64px)] max-w-[920px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-line bg-app shadow-elevated outline-none"
                      onCloseAutoFocus={(event) => event.preventDefault()}
                      aria-describedby={undefined}
                    >
                      <Dialog.Title className="sr-only">
                        {review
                          ? copy.gitReview.title
                          : `${copy.localFiles.preview}: ${fileName(preview!.path)}`}
                      </Dialog.Title>
                      <div className="flex items-start gap-1 border-b border-line p-4">
                        {review ? (
                          <span className="flex-1 text-sm font-medium text-ink">
                            {copy.gitReview.title}
                          </span>
                        ) : (
                          header
                        )}
                        <DialogCloseButton />
                      </div>
                      {body}
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>
              ))}
          </Group>
        </div>
      </GitReviewContext.Provider>
    </LocalFilesContext.Provider>
  );
}

function PreviewResizeSeparator({ onReset }: { onReset: () => void }) {
  const copy = useCopy();
  const [pointerOffsetY, setPointerOffsetY] = useState(0);
  return (
    <Separator
      aria-label={copy.gitReview.resizePanel}
      disableDoubleClick
      onDoubleClick={onReset}
      className="group relative w-1.5 shrink-0 cursor-col-resize outline-none"
    >
      <TooltipLabel
        text={copy.localFiles.resizeHint}
        side="left"
        align="start"
        alignOffset={pointerOffsetY}
      >
        <div
          className="absolute inset-0"
          onPointerEnter={(event) => {
            setPointerOffsetY(
              Math.max(
                0,
                event.clientY -
                  event.currentTarget.getBoundingClientRect().top -
                  12,
              ),
            );
          }}
        />
      </TooltipLabel>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line/70 group-hover:bg-brand group-active:bg-brand group-focus-visible:bg-brand" />
    </Separator>
  );
}
