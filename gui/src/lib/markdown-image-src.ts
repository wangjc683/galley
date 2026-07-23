import { convertFileSrc } from "@tauri-apps/api/core";
import { defaultUrlTransform } from "react-markdown";

// Pure src / path resolution for markdown images: recognise absolute
// local paths (POSIX / Windows / UNC / file: URLs) that agents drop
// into markdown, and convert them to Tauri asset URLs for preview.

const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_RE = /^\\\\[^\\]+\\[^\\]+/;

export function markdownUrlTransform(
  value: string,
  key: string,
  node: { tagName?: string },
): string | null | undefined {
  if (
    key === "src" &&
    node.tagName === "img" &&
    localPathFromMarkdownImageSrc(value)
  ) {
    return value;
  }
  return defaultUrlTransform(value);
}

export function localPathFromMarkdownImageSrc(src: string): string | null {
  if (/^file:\/\//i.test(src)) return fileUrlToLocalPath(src);

  const path = decodeMarkdownLocalPath(src);
  return isAbsoluteLocalPath(path) ? path : null;
}

function fileUrlToLocalPath(src: string): string | null {
  try {
    const url = new URL(src);
    if (url.protocol !== "file:") return null;
    const path = decodeURIComponent(url.pathname);
    if (url.hostname && url.hostname !== "localhost") {
      return `\\\\${decodeURIComponent(url.hostname)}${path.replace(/\//g, "\\")}`;
    }
    return /^\/[a-zA-Z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    return null;
  }
}

export function decodeMarkdownLocalPath(src: string): string {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
}

function isAbsoluteLocalPath(src: string): boolean {
  return (
    src.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_RE.test(src) ||
    WINDOWS_UNC_PATH_RE.test(src)
  );
}

export function localPathToAssetSrc(path: string): string | null {
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}
