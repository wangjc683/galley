import { Check, Copy } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

import { useResolvedTheme } from "@/components/theme/ThemeContext";
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

const SHIKI_THEMES = {
  light: "github-light",
  dark: "github-dark",
} as const;

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
 * doesn't already. We suppress the floating tag for these so plain
 * snippets show no label at all (the copy / wrap controls still float
 * in on hover), rather than stamping "TEXT" noise on every block.
 */
const UNINFORMATIVE_CODE_LABELS = new Set(["text", "txt", "plaintext", "plain"]);

function displayCodeLabel(language: string | null): string {
  if (!language) return "";
  return UNINFORMATIVE_CODE_LABELS.has(language.toLowerCase()) ? "" : language;
}

/**
 * Highlighted code block. Async render: while Shiki loads / when an
 * unsupported language is supplied, falls back to the plain mono
 * block (same chrome, no colors). The plain fallback is rendered
 * synchronously so there's no flash of empty / placeholder content.
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
      : (cachedHtml ??
        (lang && highlighted ? highlighted.html : null));
  const [wrapped, setWrapped] = useState(false);
  const wrapLabel = wrapped
    ? copy.conversation.scrollCode
    : copy.conversation.wrapCode;

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

  const label = displayCodeLabel(language);

  return (
    <div className="group/codeblock relative my-3 overflow-hidden rounded-md border border-line-strong bg-code-surface">
      {/* No header bar: it wasted a full row (and read as a dead white
          strip once the language label was suppressed). The language
          tag + controls float in the top-right corner instead, so the
          box is just the code. Top-right rather than top-left because
          code starts flush-left — a left tag would sit on the first
          line. The language tag is always shown (dim); wrap / copy
          fade in on hover to its left. */}
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
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
            "inline-flex items-center rounded-sm bg-code-surface/85 px-1.5 py-0.5 text-[10.5px] uppercase tracking-[0.08em] backdrop-blur-sm",
            "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
            wrapped
              ? "text-ink-soft opacity-100"
              : "text-ink-muted opacity-0 hover:text-ink-soft group-hover/codeblock:opacity-100",
            "hover:bg-hover",
          )}
        >
          {wrapLabel}
        </button>
        <CodeCopyButton code={code} />
        {label && (
          <span className="pointer-events-none select-none font-mono text-[10px] uppercase tracking-[0.08em] text-ink-muted/70">
            {label}
          </span>
        )}
      </div>
      <div
        className={cn(
          "px-3.5 py-1.5 font-mono [font-size:var(--conversation-code-size)] leading-[1.45] text-ink",
          wrapped
            ? "overflow-x-hidden break-words [&_code]:whitespace-pre-wrap [&_pre]:whitespace-pre-wrap"
            : "overflow-x-auto [&_code]:whitespace-pre [&_pre]:whitespace-pre",
          // Shiki's colored spans arrive via the innerHTML payload. Zero
          // out every box-model contribution from pre/code so the only
          // vertical space is this wrapper's py-1.5 — no UA / Shiki
          // line-box padding leaking in and inflating the block.
          "[&_pre]:m-0 [&_pre]:p-0 [&_pre]:bg-transparent [&_pre]:leading-[1.45]",
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
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre>
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * Copy button on each code block. Hover-revealed (not always-on) so
 * resting code blocks feel uncluttered; Claude.ai / ChatGPT use the
 * same hover pattern. Uses the parent's `group/codeblock` for hover
 * scoping so nested code blocks don't trigger each other.
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
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("[CodeCopyButton] copy failed", e);
    }
  };

  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={preventMouseFocus}
      onClick={(event) => {
        void onCopy();
        blurAfterClick(event);
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm bg-code-surface/85 px-1.5 py-0.5 text-[10.5px] uppercase tracking-[0.08em] backdrop-blur-sm",
        "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
        "opacity-0 group-hover/codeblock:opacity-100",
        copied
          ? "text-success"
          : "text-ink-muted hover:bg-hover hover:text-ink-soft",
      )}
    >
      {copied ? (
        <Check size={11} weight="bold" />
      ) : (
        <Copy size={11} weight="thin" />
      )}
      <span>{copied ? copy.conversation.copied : copy.conversation.copy}</span>
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
  };
  if (lower in alias) return alias[lower];
  if (SHIKI_LANGUAGES.includes(lower as ShikiLang)) {
    return lower as ShikiLang;
  }
  return null;
}
