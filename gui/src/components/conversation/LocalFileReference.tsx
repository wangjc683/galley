import { FolderOpen } from "@phosphor-icons/react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useContext, type ReactNode } from "react";
import { IconButton } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import {
  documentReference,
  isMarkdownPath,
  localFilePath,
} from "@/lib/local-file-path";
import {
  DocumentPathContext,
  InsideLinkContext,
  LocalFilesContext,
  fileOperation,
} from "@/lib/local-files";

export function LocalFileReference({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const activate = useContext(LocalFilesContext);
  const copy = useCopy();
  if (!activate) return <>{children}</>;
  const markdown = isMarkdownPath(path);
  return (
    <InsideLinkContext.Provider value={true}>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <span
            data-galley-context-menu-trigger=""
            className="inline rounded-sm"
          >
            <TooltipLabel
              text={markdown ? copy.localFiles.preview : copy.localFiles.locate}
            >
              <button
                type="button"
                className="file-path-button break-words rounded-[4px] text-left text-brand-strong underline decoration-brand-strong/35 underline-offset-2 focus-visible:outline focus-visible:outline-2"
                onClick={(event) => activate(path, event.currentTarget)}
              >
                {children}
              </button>
            </TooltipLabel>
            {markdown && (
              <IconButton
                ariaLabel={copy.localFiles.locate}
                className="file-reveal-button ml-0.5 inline-flex h-6 w-6 align-middle"
                onClick={() => void fileOperation(path, "reveal", copy)}
              >
                <FolderOpen size={14} weight="thin" />
              </IconButton>
            )}
          </span>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="z-50 min-w-40 rounded-md border border-line bg-elevated p-1 text-[12.5px] text-ink shadow-elevated">
            <ContextMenu.Item
              className="cursor-default rounded-sm px-2.5 py-1.5 outline-none data-[highlighted]:bg-hover"
              onSelect={() => void fileOperation(path, "copy", copy)}
            >
              {copy.localFiles.copyPath}
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </InsideLinkContext.Provider>
  );
}

export function FileInlineCode({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const insideLink = useContext(InsideLinkContext);
  const path =
    !insideLink && typeof children === "string"
      ? localFilePath(children)
      : null;
  const code = <code className={className}>{children}</code>;
  return path ? (
    <LocalFileReference path={path}>{code}</LocalFileReference>
  ) : (
    code
  );
}

export function FileAnchor({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const documentPath = useContext(DocumentPathContext);
  const resolved = href ? documentReference(href, documentPath) : undefined;
  if (documentPath && resolved?.startsWith("#")) {
    return (
      <InsideLinkContext.Provider value={true}>
        <a
          href={resolved}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            let id: string;
            try {
              id = decodeURIComponent(resolved.slice(1));
            } catch {
              return;
            }
            const headings = event.currentTarget
              .closest("[data-document-preview]")
              ?.querySelectorAll("[id]");
            for (const heading of headings ?? []) {
              if (heading.id === id) {
                heading.scrollIntoView({ block: "start" });
                break;
              }
            }
          }}
        >
          {children}
        </a>
      </InsideLinkContext.Provider>
    );
  }
  const path = resolved ? localFilePath(resolved, true) : null;
  if (path)
    return <LocalFileReference path={path}>{children}</LocalFileReference>;
  // Relative chat references have no reliable base; don't navigate the WebView.
  const external = resolved && /^(?:https?:|mailto:)/i.test(resolved);
  return (
    <InsideLinkContext.Provider value={true}>
      {external ? (
        <a href={resolved} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      ) : (
        <a>{children}</a>
      )}
    </InsideLinkContext.Provider>
  );
}
