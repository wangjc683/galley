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

export type PreviewKind = "markdown" | "image" | "text";

// Mirrors of Core's `local_file.rs` classification lists. The GUI only
// uses them for the affordance a reference shows before it is clicked
// (tooltip, folder button); the click itself asks Core (`inspect`), whose
// answer wins. Keep the two in step when editing either.
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const TEXT_EXTENSIONS = new Set([
  "txt", "log", "csv", "tsv", "json", "jsonl", "ndjson", "yaml", "yml",
  "toml", "ini", "cfg", "conf", "env", "xml", "html", "htm", "css", "scss",
  "less", "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "pyi", "rs", "go",
  "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "rb",
  "php", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "r", "lua",
  "pl", "pm", "ex", "exs", "erl", "dart", "scala", "hs", "clj", "cljs", "vue",
  "svelte", "graphql", "gql", "proto", "diff", "patch", "mdx", "rst", "tex",
  "bib", "gitignore", "gitattributes", "editorconfig", "dockerfile",
  "makefile", "lock", "properties", "plist", "srt", "vtt",
]);
const TEXT_BASENAMES = new Set([
  "makefile", "dockerfile", "license", "licence", "readme", "changelog",
  "authors", "contributing", "gemfile", "rakefile", "procfile", "justfile",
  "pipfile", "brewfile",
]);
/** Text kinds the default application merely displays; scripts are
 * excluded so "open with default app" never executes a chat-borne path. */
const OPENABLE_TEXT_EXTENSIONS = new Set([
  "txt", "log", "csv", "tsv", "json", "jsonl", "ndjson", "yaml", "yml",
  "toml", "xml", "ini", "cfg", "conf", "rst", "tex", "srt", "vtt",
]);
/** Documents the default application opens and only displays (main chat
 * tickets 73, 74): the mirror of the document list Core's `is_openable`
 * lets through in core/src/local_file.rs (ticket 73's
 * `OPENABLE_DOCUMENT_EXTENSIONS`), letter for letter. The legacy and
 * macro-enabled Office formats (doc, xls, ppt, docm, xlsm, pptm) and
 * Keynote are left out there on purpose, so here too. */
const OPENABLE_DOCUMENT_EXTENSIONS = new Set([
  "pdf", "docx", "xlsx", "pptx", "pages", "numbers", "html", "htm",
]);

function extensionOf(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  // A dotfile's whole name after the dot is its type (`.gitignore`,
  // `.env`), matching Core's classification.
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** What the reading panel would show for this path, judged by name alone;
 * `null` means the reference only reveals in the file manager. Core may
 * still promote an extension-less file to `text` by sniffing its bytes. */
export function previewKindByPath(path: string): PreviewKind | null {
  if (isMarkdownPath(path)) return "markdown";
  const extension = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension ? TEXT_EXTENSIONS.has(extension) : TEXT_BASENAMES.has(fileName(path).toLowerCase()))
    return "text";
  return null;
}

export function isOpenableWithDefaultApp(path: string): boolean {
  const extension = extensionOf(path);
  return (
    isMarkdownPath(path) ||
    IMAGE_EXTENSIONS.has(extension) ||
    OPENABLE_TEXT_EXTENSIONS.has(extension) ||
    OPENABLE_DOCUMENT_EXTENSIONS.has(extension)
  );
}

/** One of the documents above (pdf, docx, html, …): what a file card the
 * assistant handed over opens in its default application, HTML included
 * — a delivered page is seen rendered, not as source (ticket 74). */
export function isOpenableDocument(path: string): boolean {
  return OPENABLE_DOCUMENT_EXTENSIONS.has(extensionOf(path));
}

/**
 * What a click on a file reference in the text does, by name (ticket
 * 74): what the reading panel shows opens there, HTML as source too
 * (the workbench's references are mostly code); a document it cannot
 * show but the default application may open (pdf, docx, …) opens
 * there; anything else is left to the reading panel's own judgment,
 * which reveals it in its folder unless Core sniffs it as text.
 */
export function referenceClick(path: string): "preview" | "open" | "locate" {
  if (previewKindByPath(path) !== null) return "preview";
  return isOpenableWithDefaultApp(path) ? "open" : "locate";
}

/** Data files render as a table when they parse cleanly. */
export function isDelimitedPath(path: string): "," | "\t" | null {
  const extension = extensionOf(path);
  if (extension === "csv") return ",";
  if (extension === "tsv") return "\t";
  return null;
}

export function isJsonPath(path: string): boolean {
  return extensionOf(path) === "json";
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
