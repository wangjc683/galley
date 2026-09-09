import { createContext } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppCopy } from "@/lib/i18n";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

export interface LocalFileResult {
  path: string;
  /** `text` and `image` are additive kinds (2026-09-09); `file` is
   * anything the reading panel does not open and only reveals. */
  kind: "directory" | "markdown" | "text" | "image" | "file";
  content: string | null;
}
export type FileAction = "inspect" | "read" | "reveal" | "open" | "read_image";
export function accessLocalFile(
  path: string,
  action: FileAction,
): Promise<LocalFileResult> {
  return invoke("access_local_file", { request: { path, action } });
}

export const LocalFilesContext = createContext<
  ((path: string, source: HTMLElement) => void) | null
>(null);
export const DocumentPathContext = createContext<string | null>(null);
export const InsideLinkContext = createContext(false);

export function localFileError(error: unknown, copy: AppCopy): string {
  const detail = String(error);
  if (detail.includes("local_file_missing")) return copy.localFiles.missing;
  if (detail.includes("local_file_permission"))
    return copy.localFiles.permission;
  if (detail.includes("local_file_too_large")) return copy.localFiles.tooLarge;
  if (detail.includes("local_file_encoding")) return copy.localFiles.encoding;
  if (
    detail.includes("local_file_unsupported") ||
    detail.includes("local_file_absolute_required")
  )
    return copy.localFiles.unsupported;
  return copy.localFiles.failed;
}

export async function fileOperation(
  path: string,
  action: "reveal" | "open" | "copy",
  copy: AppCopy,
): Promise<void> {
  try {
    if (action === "copy") await navigator.clipboard.writeText(path);
    else await accessLocalFile(path, action);
  } catch (error) {
    reportFileError(error, copy);
  }
}

export function reportFileError(error: unknown, copy: AppCopy): void {
  useUiStore.getState().pushToast(
    makeAppError({
      category: "business",
      severity: "error",
      message: localFileError(error, copy),
      hint: null,
      retryable: false,
      context: "local_file.access",
      traceback: String(error),
    }),
  );
}
