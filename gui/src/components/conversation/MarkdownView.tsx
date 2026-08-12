import { Check } from "@phosphor-icons/react";
import {
  Children,
  type CSSProperties,
  isValidElement,
  memo,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock } from "@/components/conversation/CodeBlock";
import { MarkdownImage } from "@/components/conversation/MarkdownImage";
import { markdownUrlTransform } from "@/lib/markdown-image-src";
import { remarkCjkAdjacentQuotedStrong } from "@/lib/remark-cjk-strong";
import { cn } from "@/lib/utils";

/**
 * Markdown rendering for agent output (final answers + thinking
 * summaries). Per DESIGN.md §4.3 markdown spec.
 *
 * Stack:
 *   - react-markdown for the parse / React-tree side (no
 *     dangerouslySetInnerHTML; sanitised by virtue of the schema)
 *   - remark-gfm for GitHub-flavoured extensions (tables, task
 *     lists, autolink, strikethrough)
 *   - shiki for code-block syntax highlighting (see `CodeBlock.tsx`),
 *     with a hand-picked language set so we don't ship every TextMate
 *     grammar known to mankind. Languages outside the list fall back
 *     to the plain mono code block — same visual chrome, just no
 *     token colours.
 *
 * Styling philosophy: every override pulls from the conversation
 * typography / UI / mono token system so the conversation reads as
 * one document, not a stylesheet collage.
 *
 * The component-level overrides give us this without touching
 * globals.css — typography lives at the boundary, not in CSS
 * cascade-land.
 */

interface MarkdownViewProps {
  /** Raw markdown source from the LLM. */
  source: string;
  /**
   * Visual register. "agent" = serif body (final answer floating in
   * the document). "narration" = the same body register for
   * intermediate assistant prose; callers distinguish it by layout
   * and actions, not typography, so streaming text does not jump when
   * it settles into an intermediate turn. "thinking" = serif italic
   * muted (thinking summary callout). Layout chrome (padding /
   * background / brand bar) is the caller's job — this component
   * renders inline content only.
   */
  variant: "agent" | "narration" | "thinking";
  className?: string;
  selectionCopyScope?: boolean;
}

// Memoised: `source` (the markdown string) is the only prop that
// changes meaningfully; `variant`/`className` are stable per call site.
// During streaming the parent re-renders on every throttled chunk, and
// without `memo` every historical `MarkdownView` in the conversation
// would re-reconcile on each chunk even though its `source` is final
// and immutable. The memo keeps settled answers out of the streaming
// re-render path.
export const MarkdownView = memo(function MarkdownView({
  source,
  variant,
  className,
  selectionCopyScope = false,
}: MarkdownViewProps) {
  const proseClass =
    variant === "agent"
      ? PROSE_AGENT
      : variant === "narration"
        ? PROSE_NARRATION
        : PROSE_THINKING;
  // CJK prose opts back into macOS font smoothing (`auto`) instead of the
  // global `antialiased` — but only in LIGHT mode. The attribute below is
  // just the hook; the rule itself lives in globals.css keyed off
  // `html:not([data-theme="dark"])`.
  //
  // Why the override exists at all (2026-06-20, still valid in light):
  // ① PingFang under `antialiased` renders thin — grayscale AA softens
  //   stroke edges into translucency, so glyphs lose density. `auto`
  //   keeps strokes solid, which matters most in the long-form reading
  //   zones (agent answer, narration, thinking).
  // ② It deliberately makes agent prose render slightly heavier than the
  //   user message (which stays on global `antialiased`). That is the
  //   point: same font / size / weight, but the reading surface gets
  //   crisper glyphs while the input surface stays soft. If both go
  //   `auto` the contrast flattens; if both go `antialiased` the prose
  //   reads as too thin (confirmed by dogfood 2026-06-20). The asymmetry
  //   is the feature.
  // (Pre-2026-06-20 this also dodged a Songti SC glyph-clipping bug; that
  // rationale is gone with the serif, the thinness rationale remains.)
  //
  // Why it is light-only (2026-07-25): `auto` routes through macOS font
  // smoothing, which dilates strokes. Dilation is mild for dark-on-light
  // but compounds with the bloom of light-on-dark, so in dark mode this
  // same rule rendered agent prose fat and glary — the reading column was
  // the only place in the app that felt "too bright", and only for CJK
  // answers, which is exactly this rule's footprint. The 2026-06-20
  // dogfood behind ①/② was run in light only. This scopes the rule to
  // where it was actually validated; it does NOT revert it — deleting it
  // outright was already tried and rejected (foundations.md §2.2).
  const usesCjkSerif = cjkDominant(source);
  const proseStyle = {
    "--galley-prose-serif": "var(--font-serif)",
  } as CSSProperties;
  return (
    <div
      data-selection-copy-scope={
        selectionCopyScope ? "assistant-answer" : undefined
      }
      data-cjk-prose={usesCjkSerif ? "true" : undefined}
      className={cn("select-text", proseClass, className)}
      style={proseStyle}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCjkAdjacentQuotedStrong]}
        components={COMPONENTS}
        urlTransform={markdownUrlTransform}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});

// ---------- Prose-level typography (variant) ----------

/**
 * Both variants share the block rhythm, list-marker styling, link color,
 * etc. via descendant selectors. We just swap the surrounding font
 * register at the top.
 */
/**
 * Vertical rhythm (2026-08-12). Every block margin below is a multiple of
 * `--conversation-block-gap`, which conversation-font-size.ts scales with
 * the reading tier (10.5 / 12 / 13.5px). It used to be a dozen hardcoded
 * Tailwind values while size and leading scaled, so the document silently
 * tightened as the user asked for a bigger face — see that file for the
 * numbers.
 *
 * The ladder is unchanged from the hardcoded values; it just became
 * parameterised. Standard tier in brackets:
 *
 *   0.3333  [4px]   list items, nested lists
 *   0.5     [6px]   h4 close
 *   0.6667  [8px]   h3 close
 *   0.8333  [10px]  h2 close
 *   1       [12px]  paragraphs, lists, blockquote, h1 close, h4 open
 *   1.1667  [14px]  code blocks, tables — an embedded medium earns a
 *                   little more air than prose does
 *   1.3333  [16px]  h3 open
 *   1.6667  [20px]  h1 / h2 open, hr — section breaks
 *
 * Headings keep their own descending close ladder (12 / 10 / 8 / 6): the
 * bigger the heading, the more room under it. Flattening that to one
 * value would cost more than it saves.
 */
const PROSE_BASE = cn(
  // Reset child margins so the parent callout (caller's box) can
  // own outer spacing without collapse fighting.
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
  // Full-width stops (。、，) may hang into the right margin at line
  // end — classic CJK typesetting. WebKit-only; others ignore it.
  // Prose only, never UI chrome (docs/typography-principles.md).
  "[hanging-punctuation:allow-end]",
  // Paragraphs.
  "[&_p]:[margin-block:var(--conversation-block-gap)] [&_p]:[line-height:var(--conversation-body-leading)] [&_p:last-child]:mb-0",
  // Headings (document prose face, slight weight contrast against body).
  "[&_h1]:[margin-top:calc(var(--conversation-block-gap)*1.6667)] [&_h1]:[margin-bottom:var(--conversation-block-gap)] [&_h1]:font-[var(--galley-prose-serif)] [&_h1]:[font-size:var(--conversation-heading-1-size)] [&_h1]:font-medium [&_h1]:leading-[1.3] [&_h1]:tracking-[0.005em] [&_h1]:text-ink",
  "[&_h2]:[margin-top:calc(var(--conversation-block-gap)*1.6667)] [&_h2]:[margin-bottom:calc(var(--conversation-block-gap)*0.8333)] [&_h2]:font-[var(--galley-prose-serif)] [&_h2]:[font-size:var(--conversation-heading-2-size)] [&_h2]:font-medium [&_h2]:leading-[1.35] [&_h2]:text-ink",
  // h3 deliberately close to body size — DESIGN.md §4.3 calls this
  // out as a way to avoid jarring jumps inside the document flow.
  "[&_h3]:[margin-top:calc(var(--conversation-block-gap)*1.3333)] [&_h3]:[margin-bottom:calc(var(--conversation-block-gap)*0.6667)] [&_h3]:font-[var(--galley-prose-serif)] [&_h3]:[font-size:var(--conversation-heading-3-size)] [&_h3]:font-medium [&_h3]:text-ink",
  "[&_h4]:[margin-top:var(--conversation-block-gap)] [&_h4]:[margin-bottom:calc(var(--conversation-block-gap)*0.5)] [&_h4]:font-[var(--galley-prose-serif)] [&_h4]:[font-size:var(--conversation-heading-4-size)] [&_h4]:font-medium [&_h4]:text-ink",
  // Lists. ::marker pulls list bullets into the muted register so
  // they read as structure rather than content.
  "[&_ul]:[margin-block:var(--conversation-block-gap)] [&_ul]:ml-5 [&_ul]:list-disc",
  "[&_ol]:[margin-block:var(--conversation-block-gap)] [&_ol]:ml-5 [&_ol]:list-decimal",
  "[&_li]:[margin-block:calc(var(--conversation-block-gap)*0.3333)] [&_li::marker]:text-ink-muted",
  "[&_li>p]:my-0", // tight paragraphs inside list items
  // Task lists (GFM). remark-gfm tags the item `.task-list-item` and emits
  // an <input type=checkbox> inside it; the box itself is drawn by
  // `COMPONENTS.input` below. All this rule does is drop the disc, because
  // the item otherwise carries TWO markers — a bullet and a checkbox.
  // Scoped to the item, not the list: a list can mix task and plain items,
  // and the plain ones must keep their bullet.
  "[&_li.task-list-item]:list-none",
  // Nested lists tighter.
  "[&_li>ul]:[margin-block:calc(var(--conversation-block-gap)*0.3333)] [&_li>ol]:[margin-block:calc(var(--conversation-block-gap)*0.3333)]",
  // Inline code — mono token, subtle pill background, warm code ink.
  //
  // The ink is a HUE step off the prose, not a lightness step (token
  // rationale in globals.css; verdict in devlog 2026-08-12). Inline code
  // in a coding-agent answer is overwhelmingly paths, filenames, versions
  // and commands — the things the reader most needs to pick out and copy.
  // The pre-2026-08-12 treatment (`ink-soft` at 0.86em) demoted exactly
  // those: a line carrying seven filenames read as one grey smear. Value
  // scales with density, and density is the normal case here.
  //
  // `box-decoration-clone` keeps the wash whole when a span soft-wraps —
  // without it the continuation row loses its horizontal padding and the
  // rounded ends, which shows up constantly on long paths.
  "[&_:not(pre)>code]:rounded-[4px] [&_:not(pre)>code]:bg-hover [&_:not(pre)>code]:box-decoration-clone [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-px [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.92em] [&_:not(pre)>code]:text-code-ink",
  // Block code lives in CodeBlock component (renders pre + own
  // styles); we keep a fallback for any pre that escapes.
  "[&_pre]:[margin-block:calc(var(--conversation-block-gap)*1.1667)]",
  // Blockquotes — apricot-bar accent, italic, muted.
  "[&_blockquote]:[margin-block:var(--conversation-block-gap)] [&_blockquote]:border-l-[3px] [&_blockquote]:border-brand [&_blockquote]:pl-3.5 [&_blockquote]:font-[var(--galley-prose-serif)] [&_blockquote]:italic [&_blockquote]:text-ink-soft",
  // Links — body ink + a muted underline, brand only on hover.
  //
  // The warm budget in a paragraph is spent on inline code (above), so
  // links give theirs up: two warm registers in one paragraph and the
  // reader cannot tell which one is clickable. The underline still marks
  // the link, and it is the affordance that actually carries the meaning —
  // color was redundant with it. Frequency settles the trade: an agent
  // answer holds many paths and few external links.
  "[&_a]:text-ink [&_a]:underline [&_a]:underline-offset-[3px] [&_a]:decoration-ink-muted [&_a:hover]:text-brand-strong [&_a:hover]:decoration-brand-strong",
  // Tables — GFM extension. The table component wraps them in an
  // overflow container; cell styling stays here so the typography
  // remains centralized.
  "[&_th]:border [&_th]:border-line [&_th]:bg-surface [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-ink",
  "[&_td]:border [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_td]:text-ink",
  // hr inside markdown.
  "[&_hr]:[margin-block:calc(var(--conversation-block-gap)*1.6667)] [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-line",
  // Strong / em — keep weight in line with the prose body. Body is normal
  // (400), so strong at medium (500) is one visible weight step up.
  "[&_strong]:font-medium [&_strong]:text-ink",
  "[&_em]:italic",
  "[&_del]:text-ink-muted [&_del]:line-through",
);

const PROSE_AGENT = cn(
  PROSE_BASE,
  // The "final answer floats in the document" register (DESIGN.md §4.3).
  // Body is normal (400): light skeleton + the CJK `auto` smoothing
  // (above) gives solid edges — clear but not dense, right for long-form
  // reading. The user message carries medium (500) for anchor weight;
  // the two reach their own "just right" via different means.
  "font-[var(--galley-prose-serif)] [font-size:var(--conversation-body-size)] [line-height:var(--conversation-body-leading)] tracking-[0.005em] text-ink",
);

const PROSE_NARRATION = cn(
  PROSE_BASE,
  // Intermediate LLM narrator prose must match the in-flight body
  // register. Otherwise a pre-tool sentence streams as `agent`, then
  // snaps smaller/softer once turn_end classifies it as narration.
  "font-[var(--galley-prose-serif)] [font-size:var(--conversation-body-size)] [line-height:var(--conversation-body-leading)] tracking-[0.005em] text-ink",
);

const PROSE_THINKING = cn(
  PROSE_BASE,
  // Thinking summary register: italic serif muted (a notch lighter
  // than the answer body).
  "font-[var(--galley-prose-serif)] [font-size:var(--conversation-thinking-size)] italic [line-height:var(--conversation-thinking-leading)] text-ink-soft",
);

const CJK_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function cjkDominant(source: string): boolean {
  return CJK_SCRIPT.test(source);
}

// ---------- react-markdown component overrides ----------

/**
 * We route fenced code from `pre`, not `code`: react-markdown gives
 * no-language single-line fences as `<pre><code>...</code></pre>`,
 * and the code node alone is indistinguishable from inline code by
 * text shape. The pre wrapper is the reliable block signal.
 */
const COMPONENTS: Components = {
  table({ className, children, ...props }) {
    return (
      <div className="overflow-x-auto [margin-block:calc(var(--conversation-block-gap)*1.1667)]">
        <table
          className={cn(
            "w-max min-w-full border-collapse [font-size:var(--conversation-table-size)]",
            className,
          )}
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },
  pre({ children }) {
    const codeProps = getPreCodeProps(children);
    if (!codeProps) return <pre>{children}</pre>;

    const match = /language-([\w-]+)/.exec(codeProps.className ?? "");
    const text = trimCodeBlankEdges(String(codeProps.children ?? ""));
    return <CodeBlock code={text} language={match?.[1] ?? null} />;
  },
  code({ className, children }) {
    return <code className={className}>{children}</code>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    return <MarkdownImage src={src} alt={alt} />;
  },
  /**
   * GFM task-list checkbox. remark-gfm emits a bare
   * `<input type=checkbox disabled>`, which renders as the platform
   * control — a system-blue box sitting in serif prose, in the wrong
   * register and unaffected by the reading-size tiers.
   *
   * Drawn instead in the same visual language as `ui/checkbox.tsx` so a
   * checkbox means one thing everywhere in the app, and sized in `em` so
   * it tracks the reading tier. It is a span rather than a styled input
   * because the tick has to be a child element; `role`/`aria-checked`
   * carry the semantics the input was providing. Always disabled — agent
   * output is a record of what happened, not a form.
   */
  input({ type, checked }) {
    if (type !== "checkbox") return null;
    return (
      <span
        role="checkbox"
        aria-checked={checked ?? false}
        aria-disabled="true"
        className={cn(
          "mr-[0.4em] inline-flex size-[0.92em] shrink-0 items-center justify-center rounded-sm border align-middle",
          checked
            ? "border-brand bg-brand text-ink"
            : "border-line-strong bg-elevated text-transparent",
        )}
      >
        <Check size="0.62em" weight="bold" />
      </span>
    );
  },
};

/**
 * Strip blank edge lines from fenced content. react-markdown hands us
 * the code with a single trailing newline, but LLMs also routinely emit
 * a leading blank line (and sometimes extra trailing ones) inside the
 * fence; rendered verbatim those read as wasted space at the top/bottom
 * of the block. Line-based (not a single regex) so it survives `\r\n`
 * endings and whitespace-only blank lines; internal lines and the
 * indentation of real content are preserved.
 */
function trimCodeBlankEdges(code: string): string {
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

interface PreCodeProps {
  className?: string;
  children?: ReactNode;
}

function getPreCodeProps(children: ReactNode): PreCodeProps | null {
  for (const child of Children.toArray(children)) {
    if (isValidElement<PreCodeProps>(child)) return child.props;
  }
  return null;
}
