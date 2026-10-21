import {
  Copy,
  File as FileIcon,
  FileAudio,
  FileCode,
  FileCsv,
  FileDoc,
  FileHtml,
  FileImage,
  FileMd,
  FilePdf,
  FilePpt,
  FileText,
  FileVideo,
  FileXls,
  FileZip,
  Folder,
  FolderOpen,
  type Icon,
} from "@phosphor-icons/react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { invoke } from "@tauri-apps/api/core";
import { useContext, useState, type ReactElement } from "react";

import {
  ImagePreviewDialog,
  type ImagePreviewItem,
} from "@/components/conversation/ImagePreviewDialog";
import { IconButton } from "@/components/ui/button";
import { FolderPathText } from "@/components/ui/folder-path";
import { useFilePresences } from "@/hooks/useFilePresence";
import {
  fileCardRuns,
  fileFolder,
  fileGlyph,
  splitFileName,
  thumbnailPath,
  type FileGlyph,
  type FilePresence,
} from "@/lib/file-cards";
import { useCopy } from "@/lib/i18n";
import { fileName } from "@/lib/local-file-path";
import { fileOperation, LocalFilesContext } from "@/lib/local-files";
import { localPathToAssetSrc } from "@/lib/markdown-image-src";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { cn } from "@/lib/utils";

/**
 * The files the assistant handed over in one reply, under its bubble
 * (main chat ticket 74, assistant PRD ruling 10): one card per
 * `[FILE:<path>]` marker, in marker order, first of the cards a reply
 * can carry (the reply's own deliverable, then the work it handed off,
 * the to-dos, the reminders). The main chat only; MainView hands the
 * paths in.
 *
 * A card is the reminder card's frame (hairline `border-line`,
 * `rounded-md`, the page ground, one 40px line, no shadow, no lift): the
 * file's glyph, its name cut in the middle so the extension stays, and
 * its folder with the home part as `~`. Never the whole path. A click
 * goes where a file reference in the text goes (LocalFileWorkspace's
 * `activate`): what the reading panel previews (text, Markdown, HTML
 * source, images) opens there, anything else shows in its folder. On
 * hover, and on a right-click with 复制路径, 「在文件夹中显示」.
 *
 * A png / jpg / jpeg / gif / webp draws as the user's own image
 * attachment does: a 96px thumbnail through the asset protocol, opening
 * the conversation's image viewer (ImagePreviewDialog, its 打开原始文件
 * `open_conversation_image`). One that does not load draws as a file.
 *
 * Whether the file is still there is asked of Core once, when the cards
 * mount (useFilePresences). A gone one keeps its card, faded, with
 * 「已移走或删除」 after the name; a click on it only asks again, and
 * opens the file if it is back — never an error. A file that went after
 * the check is caught the same way: every click asks first.
 */
export function FileCards({ paths }: { paths: readonly string[] }) {
  const copy = useCopy();
  const activate = useContext(LocalFilesContext);
  const { presence, recheck } = useFilePresences(paths);
  // Thumbnails whose image did not load (outside the asset scope, not
  // really an image): drawn as files from then on.
  const [broken, setBroken] = useState<readonly string[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const thumbnails: (ImagePreviewItem & { path: string })[] = [];
  for (const path of paths) {
    if (broken.includes(path)) continue;
    const file = thumbnailPath(path, presence[path]);
    const src = file ? localPathToAssetSrc(file) : null;
    if (!file || !src) continue;
    thumbnails.push({
      path,
      id: path,
      src,
      alt: fileName(path),
      openOriginalPath: file,
    });
  }
  const thumbnailIndex = new Map(thumbnails.map((t, i) => [t.path, i]));
  const runs = fileCardRuns(paths, (path) => thumbnailIndex.has(path));

  const open = async (path: string, source: HTMLElement) => {
    const answer = await recheck(path);
    if (answer.state === "missing") return;
    if (activate) activate(path, source);
    else void fileOperation(path, "reveal", copy);
  };
  const openThumbnail = async (path: string) => {
    const answer = await recheck(path);
    if (answer.state === "missing") return;
    const index = thumbnailIndex.get(path);
    if (index !== undefined) setPreviewIndex(index);
  };
  const openOriginal = (item: ImagePreviewItem) => {
    if (!item.openOriginalPath) return;
    void invoke("open_conversation_image", {
      kind: "local",
      source: item.openOriginalPath,
    }).catch((e: unknown) => {
      console.warn("[FileCards] open image failed", e);
    });
  };

  return (
    <>
      <div data-role="file-cards" className="mt-3 flex flex-col gap-2">
        {runs.map((run) =>
          run.kind === "images" ? (
            <div
              key={`images:${run.paths[0]}`}
              className="flex flex-wrap gap-2"
            >
              {run.paths.map((path) => (
                <ThumbnailCard
                  key={path}
                  path={path}
                  src={thumbnails[thumbnailIndex.get(path) ?? 0].src}
                  onOpen={() => void openThumbnail(path)}
                  onBroken={() =>
                    setBroken((was) =>
                      was.includes(path) ? was : [...was, path],
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <FileCard
              key={run.path}
              path={run.path}
              presence={presence[run.path]}
              onOpen={(source) => void open(run.path, source)}
            />
          ),
        )}
      </div>
      {thumbnails.length > 0 && (
        <ImagePreviewDialog
          images={thumbnails}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onOpenOriginal={openOriginal}
        />
      )}
    </>
  );
}

const GLYPHS: Record<FileGlyph, Icon> = {
  folder: Folder,
  image: FileImage,
  pdf: FilePdf,
  doc: FileDoc,
  sheet: FileXls,
  csv: FileCsv,
  slides: FilePpt,
  html: FileHtml,
  markdown: FileMd,
  text: FileText,
  code: FileCode,
  archive: FileZip,
  audio: FileAudio,
  video: FileVideo,
  file: FileIcon,
};

function FileCard({
  path,
  presence,
  onOpen,
}: {
  path: string;
  presence: FilePresence | undefined;
  onOpen: (source: HTMLElement) => void;
}) {
  const copy = useCopy();
  const missing = presence?.state === "missing";
  const name = fileName(path);
  const folder = fileFolder(path);
  const Glyph = GLYPHS[fileGlyph(path, presence)];
  return (
    <FileMenu path={path} missing={missing}>
      <div
        data-role="file-card"
        data-file-state={missing ? "missing" : "present"}
        data-galley-context-menu-trigger=""
        className="group/file-card relative"
      >
        <button
          type="button"
          aria-label={
            missing ? `${name} · ${copy.localFiles.cardMissing}` : name
          }
          onClick={(event) => onOpen(event.currentTarget)}
          className={cn(
            "flex min-h-10 w-full select-none items-center gap-2.5 rounded-md border border-line bg-app py-1.5 pl-4 pr-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
            // The hover lives on the card, so the 在文件夹中显示 button
            // over its right end keeps it; the press is the session
            // row's 1px, no shadow (the conversation is paper).
            !missing &&
              cn(
                "group-hover/file-card:bg-hover",
                "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
                // Room for that button, as a sidebar row's text gives
                // way to its ⋯.
                "group-focus-within/file-card:pr-11 group-hover/file-card:pr-11",
              ),
          )}
        >
          <span className="flex h-5 w-4 shrink-0 items-center justify-center text-ink-muted">
            <Glyph size={14} weight="thin" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <FileNameText
              name={name}
              className={missing ? "text-ink-muted" : "text-ink"}
            />
            {missing && (
              <span className="shrink-0 text-[12px] text-ink-muted">
                {copy.localFiles.cardMissing}
              </span>
            )}
          </span>
          {folder && (
            <FolderPathText
              path={folder}
              className="max-w-[45%] shrink-0 text-[12px] text-ink-muted"
            />
          )}
        </button>
        {!missing && (
          <div className="absolute inset-y-0 right-1.5 flex items-center opacity-0 group-focus-within/file-card:opacity-100 group-hover/file-card:opacity-100">
            <IconButton
              ariaLabel={copy.localFiles.locate}
              onClick={() => void fileOperation(path, "reveal", copy)}
            >
              <FolderOpen size={14} weight="thin" />
            </IconButton>
          </div>
        )}
      </div>
    </FileMenu>
  );
}

/** The name with its extension kept: the head takes the ellipsis, the
 * tail never; the whole name on hover when the head is cut. */
function FileNameText({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const { head, tail } = splitFileName(name);
  return (
    <span
      data-role="file-name"
      className={cn("flex min-w-0 text-[13px] leading-5", className)}
      onPointerEnter={(event) => {
        const cut = event.currentTarget.firstElementChild;
        if (cut instanceof HTMLElement) syncTruncatedTitle(cut, name);
      }}
    >
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
        {head}
      </span>
      {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
    </span>
  );
}

/** An image the reply handed over: the user's attachment thumbnail
 * (96px, cropped to fill), on the page's hairline. */
function ThumbnailCard({
  path,
  src,
  onOpen,
  onBroken,
}: {
  path: string;
  src: string;
  onOpen: () => void;
  onBroken: () => void;
}) {
  const copy = useCopy();
  const name = fileName(path);
  return (
    <FileMenu path={path} missing={false}>
      <button
        type="button"
        data-role="file-card"
        data-file-state="present"
        data-file-kind="image"
        data-galley-context-menu-trigger=""
        aria-label={`${copy.conversation.previewImage} · ${name}`}
        onClick={onOpen}
        className={cn(
          "h-24 w-24 overflow-hidden rounded-md border border-line bg-surface outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-brand/30",
          "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
        )}
      >
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={onBroken}
          className="h-full w-full object-cover"
        />
      </button>
    </FileMenu>
  );
}

// The audited image menu's register (MarkdownImage): the pop-in, 8px
// items inside the 12px surface's 4px padding (concentric corners).
const MENU_ITEM_CLASS = cn(
  "flex cursor-default items-center gap-2 rounded-callout px-2.5 py-1.5 text-[12.5px] text-ink-soft outline-none",
  "data-[highlighted]:bg-hover data-[highlighted]:text-ink",
);

/** The right-click menu of a card: 在文件夹中显示 (not for a gone file)
 * and 复制路径. It opens instead of the reply's message menu. */
function FileMenu({
  path,
  missing,
  children,
}: {
  path: string;
  missing: boolean;
  children: ReactElement;
}) {
  const copy = useCopy();
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="galley-pop-in z-50 min-w-[160px] rounded-md border border-line bg-elevated p-1 shadow-elevated">
          {!missing && (
            <ContextMenu.Item
              onSelect={() => void fileOperation(path, "reveal", copy)}
              className={MENU_ITEM_CLASS}
            >
              <FolderOpen size={13} weight="thin" />
              {copy.localFiles.locate}
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            onSelect={() => void fileOperation(path, "copy", copy)}
            className={MENU_ITEM_CLASS}
          >
            <Copy size={13} weight="thin" />
            {copy.localFiles.copyPath}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
