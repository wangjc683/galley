import { CaretDown, Check, Code, Copy } from "@phosphor-icons/react";
import { useContext, useEffect, useRef, useState } from "react";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

import { useResolvedTheme } from "@/components/theme/ThemeContext";
import { CodeBlockContext } from "@/lib/code-block-context";
import { useCopy } from "@/lib/i18n";
import { blurAfterClick, preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

// ---------- Code block (Shiki, fine-grained imports) ----------

/**
 * Hand-picked language set. Coding-agent users hit these constantly;
 * everything else falls through to the un-highlighted block (still
 * mono, still wrapped). Adding a language is one entry here AND a
 * matching dynamic import below — fine-grained registration via
 * `shiki/core` keeps the bundle tight (the default `shiki` entry
 * pulls every TextMate grammar known to mankind, ~600 KB of dead
 * weight including emacs-lisp / wolfram / kt / ...).
 */
const SHIKI_LANGUAGES = [
  "bash",
  "css",
  "diff",
  "html",
  "javascript",
  "json",
  "markdown",
  "python",
  "rust",
  "shell",
  "sql",
  "tsx",
  "typescript",
  "yaml",
] as const;
type ShikiLang = (typeof SHIKI_LANGUAGES)[number];

/**
 * github-light / github-dark, colour-only (see the metric-identity
 * note in the body classes). A paper-ink "two-ink" theme (ink /
 * warm code-ink / muted comments) was built for the 2026-09-18 live
 * A/B and lost to these on the real app — JC preferred the structure
 * the full palette gives; see the devlog entry.
 */
const SHIKI_THEMES = {
  light: "github-light",
  dark: "github-dark",
} as const;

/**
 * Blocks longer than this fold to their first lines with a "N more
 * lines" footer (2026-09-18 verdict: 24, not the reference component's
 * 8 — in a transcript the code IS the answer, and ~24% of real blocks
 * are over 8 lines while ~5% are over 24). Streaming blocks never
 * fold (see CodeBlockContext): folding what is still being written
 * would hide the newest lines.
 */
export const CODE_COLLAPSE_LINES = 24;

let _highlighterPromise: Promise<HighlighterCore> | null = null;

// Module-level cache of finished highlight results, keyed by
// theme:lang:code. Session transcripts remount wholesale on every
// switch (Conversation is not memoized), and without this every code
// block re-runs the async highlight pass and repaints plain→colored on
// each revisit. A cache hit renders the colored HTML in the FIRST
// paint — no swap at all. Insertion-ordered Map as a cheap LRU: cap
// bounds memory (highlighted HTML runs ~5-10× the code size), and
// re-insertion on hit keeps hot transcripts resident.
const _highlightCache = new Map<string, string>();
const HIGHLIGHT_CACHE_MAX = 300;

function readHighlightCache(key: string): string | undefined {
  const html = _highlightCache.get(key);
  if (html !== undefined) {
    _highlightCache.delete(key);
    _highlightCache.set(key, html);
  }
  return html;
}

function writeHighlightCache(key: string, html: string): void {
  if (_highlightCache.has(key)) _highlightCache.delete(key);
  _highlightCache.set(key, html);
  if (_highlightCache.size > HIGHLIGHT_CACHE_MAX) {
    const oldest = _highlightCache.keys().next().value;
    if (oldest !== undefined) _highlightCache.delete(oldest);
  }
}

function getHighlighter(): Promise<HighlighterCore> {
  if (!_highlighterPromise) {
    _highlighterPromise = createHighlighterCore({
      themes: [
        import("shiki/themes/github-light.mjs"),
        import("shiki/themes/github-dark.mjs"),
      ],
      langs: [
        import("shiki/langs/bash.mjs"),
        import("shiki/langs/css.mjs"),
        import("shiki/langs/diff.mjs"),
        import("shiki/langs/html.mjs"),
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/markdown.mjs"),
        import("shiki/langs/python.mjs"),
        import("shiki/langs/rust.mjs"),
        import("shiki/langs/shellscript.mjs"),
        import("shiki/langs/sql.mjs"),
        import("shiki/langs/tsx.mjs"),
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/yaml.mjs"),
      ],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    });
  }
  return _highlighterPromise;
}

interface CodeBlockProps {
  code: string;
  language: string | null;
}

/**
 * Language ids that carry no information as a label — a fenced block
 * tagged ```text``` / ```plaintext``` says nothing the mono register
 * doesn't already. The label is suppressed for these (the header keeps
 * its code glyph so the row is never empty), rather than stamping
 * "TEXT" on every plain snippet — which is 46% of real blocks.
 */
const UNINFORMATIVE_CODE_LABELS = new Set([
  "text",
  "txt",
  "plaintext",
  "plain",
]);

function displayCodeLabel(language: string | null): string {
  if (!language) return "";
  if (UNINFORMATIVE_CODE_LABELS.has(language.toLowerCase())) return "";
  // Show the canonical name for aliases the highlighter resolves
  // ("md" → markdown); unknown ids show as written.
  return normalizeLanguage(language) ?? language;
}

function countLines(code: string): number {
  if (code === "") return 1;
  return code.split("\n").length;
}

/**
 * Highlighted code block. Async render: while Shiki loads / when an
 * unsupported language is supplied, falls back to the plain mono
 * block (same chrome, no colors). The plain fallback is rendered
 * synchronously so there's no flash of empty / placeholder content.
 *
 * Chrome (2026-09-18 reference audit, see devlog): 8px radius,
 * hairline border, recessed code surface (the inset rule — never a
 * raised white card), `leading-code` 1.6 (the foundations token the
 * 06 density pass had overridden to 1.45), block margin on the
 * conversation rhythm variable. The copy control is always visible as
 * a bare icon; the wrap toggle appears only when a line actually
 * overflows; blocks past CODE_COLLAPSE_LINES fold behind a footer.
 * Controls live in a header row (Claude.ai form), reversing the 06
 * verdict that removed it — the row is never dead now that the copy
 * control is always in it, and it takes the controls off the code so
 * a long first line is never covered. JC picked it over the corner
 * form on the real app.
 */
export function CodeBlock({ code, language }: CodeBlockProps) {
  const copy = useCopy();
  const resolvedTheme = useResolvedTheme();
  const lang = normalizeLanguage(language);
  const shikiTheme = SHIKI_THEMES[resolvedTheme];
  const highlightKey = `${shikiTheme}:${lang ?? "plain"}:${code}`;
  const [highlighted, setHighlighted] = useState<{
    key: string;
    html: string;
  } | null>(() => {
    // Seed from the module cache so a remounted block (session
    // revisit — the transcript remounts wholesale on switch) paints
    // colored on its very first frame instead of replaying the
    // plain→colored swap.
    const cached = lang ? readHighlightCache(highlightKey) : undefined;
    return cached !== undefined ? { key: highlightKey, html: cached } : null;
  });
  // Resolution order:
  //   1. This block's own state for the current key.
  //   2. The module cache — hit means a previous mount (earlier visit
  //      to this session, or this block pre-theme-switch) already paid
  //      the highlight; colored HTML lands in the first paint.
  //   3. Keep the previous highlighted HTML while the new one is in
  //      flight: during streaming every chunk changes the key, and
  //      dropping to the plain fallback each time made the block
  //      strobe plain→colored (same flash on theme switch). The stale
  //      frame lags the newest chunk by one highlight pass (a few ms
  //      once Shiki is warm) — far calmer than flickering.
  //   4. Only when this block has never highlighted (or has no
  //      language) does the plain <pre> of the CURRENT code render.
  const cachedHtml = lang ? readHighlightCache(highlightKey) : undefined;
  const html =
    highlighted?.key === highlightKey
      ? highlighted.html
      : (cachedHtml ?? (lang && highlighted ? highlighted.html : null));

  useEffect(() => {
    if (!lang) return;
    // Cache hit means this exact (theme, lang, code) is already
    // rendered — either by this mount's state initializer or via the
    // render-time cache read above. Recomputing would only churn CPU
    // on every transcript remount. (State can lag the cache after a
    // key change back to a cached value; the render path reads the
    // cache directly, so the paint stays correct.)
    if (_highlightCache.has(highlightKey)) return;
    let cancelled = false;
    getHighlighter()
      .then((h) => {
        if (cancelled) return;
        try {
          const out = h.codeToHtml(code, {
            lang,
            theme: shikiTheme,
            // Let outer wrapper own padding / background; Shiki's
            // <pre> just provides the colored tokens.
            transformers: [
              {
                pre(node) {
                  // Strip Shiki's inline background so our own
                  // container styles win — keeps the visual aligned
                  // with the rest of the document tokens.
                  delete node.properties.style;
                  return node;
                },
              },
            ],
          });
          writeHighlightCache(highlightKey, out);
          setHighlighted({ key: highlightKey, html: out });
        } catch {
          // Unknown language slip — keep the plain fallback below.
        }
      })
      .catch(() => {
        // Highlighter failed to initialize. We just keep the plain
        // block; a console.warn would spam if e.g. WebAssembly is
        // disabled in the runtime.
      });
    return () => {
      cancelled = true;
    };
  }, [code, highlightKey, lang, shikiTheme]);

  // Wrap toggle: shown only when a line actually overflows the block
  // (or while wrapped, so it can be turned back). Measured by the
  // ResizeObserver callback — it fires once on observe with the
  // initial size, so no synchronous setState in the effect body.
  const [wrapped, setWrapped] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setOverflows(el.scrollWidth > el.clientWidth + 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [code, wrapped, html]);
  const showWrapToggle = wrapped || overflows;
  const wrapLabel = wrapped
    ? copy.conversation.scrollCode
    : copy.conversation.wrapCode;

  // Fold: long blocks show their first CODE_COLLAPSE_LINES lines.
  const { collapsible } = useContext(CodeBlockContext);
  const lineCount = countLines(code);
  const foldable = collapsible && lineCount > CODE_COLLAPSE_LINES;
  const [expanded, setExpanded] = useState(false);
  const folded = foldable && !expanded;

  const label = displayCodeLabel(language);

  const wrapToggle = showWrapToggle ? (
    <button
      type="button"
      aria-pressed={wrapped}
      tabIndex={-1}
      onMouseDown={preventMouseFocus}
      onClick={(event) => {
        setWrapped((value) => !value);
        blurAfterClick(event);
      }}
      className={cn(
        "inline-flex h-6 items-center rounded-sm px-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em]",
        "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
        "hover:bg-hover hover:text-ink-soft",
        wrapped ? "text-ink-soft" : "text-ink-muted",
      )}
    >
      {wrapLabel}
    </button>
  ) : null;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-callout border border-line bg-code-surface",
        // Block rhythm: the same 1.1667× of the conversation block gap
        // MarkdownView gives tables — an embedded medium earns a
        // little more air than a paragraph (was a hardcoded my-3).
        "[margin-block:calc(var(--conversation-block-gap)*1.1667)]",
      )}
    >
      {/* Header row: the label sits left with the code glyph — the
          glyph keeps the row from reading as a dead strip when the
          label is suppressed — and the controls sit right, off the
          code entirely. */}
      <div className="flex items-center justify-between gap-2 border-b border-line py-1 pr-1 pl-3">
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-muted">
          <Code size={12} weight="regular" className="shrink-0 opacity-80" />
          {label && <span className="truncate">{label}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {wrapToggle}
          <CodeCopyButton code={code} />
        </span>
      </div>
      <div
        ref={bodyRef}
        className={cn(
          "px-3.5 py-2 font-mono [font-size:var(--conversation-code-size)] leading-code text-ink",
          wrapped
            ? "overflow-x-hidden break-words [&_code]:whitespace-pre-wrap [&_pre]:whitespace-pre-wrap"
            : "overflow-x-auto [&_code]:whitespace-pre [&_pre]:whitespace-pre",
          // Shiki's colored spans arrive via the innerHTML payload. Zero
          // out every box-model contribution from pre/code so the only
          // vertical space is this wrapper's padding — no UA / Shiki
          // line-box padding leaking in and inflating the block.
          "[&_pre]:m-0 [&_pre]:p-0 [&_pre]:bg-transparent [&_pre]:leading-code",
          "[&_code]:m-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:[font-size:var(--conversation-code-size)]",
          // Metric identity: the plain fallback and the colored HTML
          // must wrap at exactly the same points, or the async swap
          // reflows the block and everything below it. Font, size and
          // line-height are pinned above; the remaining variable is
          // the theme itself — the github themes emit bold/italic for
          // markdown/diff tokens, and those glyph-width differences
          // shift wrap points. Shiki inlines them as style attributes,
          // so the neutralization needs !important. Highlighting is
          // deliberately color-only.
          "[&_code_span]:font-normal! [&_code_span]:[font-style:normal]!",
        )}
      >
        <div
          className={cn(folded && "overflow-hidden")}
          style={
            folded
              ? {
                  maxHeight: `calc(${CODE_COLLAPSE_LINES} * var(--leading-code) * var(--conversation-code-size, 13px))`,
                }
              : undefined
          }
        >
          {html ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre>
              <code>{code}</code>
            </pre>
          )}
        </div>
      </div>
      {foldable && (
        <button
          type="button"
          aria-expanded={expanded}
          tabIndex={-1}
          onMouseDown={preventMouseFocus}
          onClick={(event) => {
            setExpanded((value) => !value);
            blurAfterClick(event);
          }}
          className={cn(
            "flex w-full items-center justify-center gap-1 border-t border-line py-1 font-mono text-[10.5px] text-ink-muted",
            "hover:bg-hover hover:text-ink-soft",
            "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
          )}
        >
          {expanded
            ? copy.conversation.collapseCode
            : copy.conversation.moreLines(lineCount - CODE_COLLAPSE_LINES)}
          <CaretDown
            size={11}
            weight="bold"
            className={cn(
              "transition-transform duration-(--motion-base) ease-firm",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
    </div>
  );
}

/**
 * Copy button on each code block. Always visible as a bare icon
 * (2026-09-18, was hover-revealed with a "COPY" word): in a transcript
 * where most blocks are commands, paths and error lines, copying is
 * the primary action, not a secondary one. Copy → check crossfades
 * with a touch of blur — user-triggered, one-shot, so §2.7 class A.
 */
function CodeCopyButton({ code }: { code: string }) {
  const copy = useCopy();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      console.warn("[CodeCopyButton] copy failed", e);
    }
  };

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={copied ? copy.conversation.copied : copy.conversation.copy}
      title={copy.conversation.copy}
      onMouseDown={preventMouseFocus}
      onClick={(event) => {
        void onCopy();
        blurAfterClick(event);
      }}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-sm text-ink-muted",
        "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
        "hover:bg-hover hover:text-ink-soft",
      )}
    >
      <span className="relative grid size-3.5 place-items-center">
        <Copy
          size={13}
          weight="regular"
          className={cn(
            "absolute transition-[opacity,filter] duration-(--motion-base) ease-firm",
            copied ? "opacity-0 blur-[2px]" : "opacity-100 blur-0",
          )}
        />
        <Check
          size={13}
          weight="bold"
          className={cn(
            "absolute text-success transition-[opacity,filter] duration-(--motion-base) ease-firm",
            copied ? "opacity-100 blur-0" : "opacity-0 blur-[2px]",
          )}
        />
      </span>
    </button>
  );
}

/**
 * react-markdown reports language via className "language-foo".
 * Returns the language id only when it's one Shiki knows about —
 * unknown / missing returns null and skips highlighting entirely
 * (so we don't fire an Effect that's guaranteed to fail).
 */
function normalizeLanguage(language: string | null): ShikiLang | null {
  if (!language) return null;
  const lower = language.toLowerCase();
  // Common aliases users / LLMs type.
  const alias: Record<string, ShikiLang> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    rs: "rust",
    sh: "bash",
    yml: "yaml",
    md: "markdown",
  };
  if (lower in alias) return alias[lower];
  if (SHIKI_LANGUAGES.includes(lower as ShikiLang)) {
    return lower as ShikiLang;
  }
  return null;
}
