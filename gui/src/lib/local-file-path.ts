/** Recognize explicit local references only. Never guess a chat's relative base. */
export function localFilePath(
  value: string,
  urlEncoded = false,
): string | null {
  if (!value || hasControlCharacters(value)) return null;
  if (/^file:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.search || url.username || url.password || url.port) return null;
      const path = decodeURIComponent(url.pathname);
      if (hasControlCharacters(path)) return null;
      if (url.hostname && url.hostname !== "localhost") {
        return `\\\\${url.hostname}${path.replace(/\//g, "\\")}`;
      }
      return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path;
    } catch {
      return null;
    }
  }
  let path = value;
  if (urlEncoded) {
    // URL fragments name sections; literal #/? in filenames must be encoded.
    path = value.split("#", 1)[0];
    if (path.includes("?")) return null;
    try {
      path = decodeURIComponent(path);
    } catch {
      return null;
    }
  }
  if (hasControlCharacters(path)) return null;
  return /^(?:\/(?!\/)|~[\\/]|[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(path)
    ? path
    : null;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
}

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

/** Relative links/images inside a document have an unambiguous base. */
export function documentReference(
  value: string,
  documentPath: string | null,
): string {
  if (
    !documentPath ||
    !value ||
    value.startsWith("#") ||
    localFilePath(value, true) ||
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)
  )
    return value;
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(documentPath);
  const base = documentPath.replace(/\\/g, "/");
  const directory = base.slice(0, base.lastIndexOf("/") + 1);
  // Encode the known filesystem base before URL resolution so literal #/%/? in
  // directory names remain names. Relative hrefs retain normal URL encoding.
  const baseUrl =
    windows && base.startsWith("//")
      ? `file:${directory.split("/").map(encodeURIComponent).join("/")}`
      : `file://${windows ? "/" : ""}${directory
          .split("/")
          .map((s, i) => (windows && i === 0 ? s : encodeURIComponent(s)))
          .join("/")}`;
  try {
    return new URL(value.replace(/\\/g, "/"), baseUrl).href;
  } catch {
    return value;
  }
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
