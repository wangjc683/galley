import { Check, Copy, Quotes } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { ActionChip } from "@/components/conversation/ActionChip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import {
  SELECTION_COPY_SCOPE as ASSISTANT_SELECTION_SCOPE,
  SELECTION_YIELD_REGION,
  selectionToolbarServes,
} from "@/lib/selection-copy";
import { cn } from "@/lib/utils";

const TOOLBAR_SELECTOR = "[data-selection-copy-toolbar]";
const VIEWPORT_GAP = 12;
const TOOLBAR_GUTTER_GAP = 10;
/** One chip, the hover rows' own (`inline`, `size-6`). */
const CHIP_SIZE = 24;
/** Between copy and quote (`gap-0.5`), as between a hover row's chips. */
const CHIP_GAP = 2;
/** The shell's edge to a chip: its 1px border and its `p-1.5` (6px). */
const SHELL_INSET = 7;
/** The shell's width (38px): one chip and the inset on either side. */
const TOOLBAR_WIDTH = CHIP_SIZE + SHELL_INSET * 2;
/** From the shell's top to the middle of copy, its first chip. */
const COPY_MIDDLE = SHELL_INSET + CHIP_SIZE / 2;

interface SelectionCopyToolbarProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /**
   * 「引用」 (telegram-details ticket 02): hand the selected text to the
   * composer as a quote. Without it the toolbar is copy alone.
   */
  onQuote?: (text: string) => void;
}

type ToolbarSide = "left" | "right" | "viewport-left";

interface ToolbarState {
  text: string;
  left: number;
  top: number;
  side: ToolbarSide;
  /** The key of the message it serves (`data-selection-yield` on its
   * hover region), whose hover row yields while it shows. */
  serves: string | null;
}

/**
 * A floating shell beside a selection in a reply (or, in the assistant's
 * conversation, in your bubble) holding copy, and quote into the
 * composer. A column in the gutter, copy on top where it always sat (its
 * middle on the selection's last line), quote under it.
 *
 * While it shows, the message it serves keeps its hover row down (main
 * chat PRD ruling 108; lib/selection-copy): one set of actions at a
 * time, not two copies and two quotes that act on different things.
 */
export function SelectionCopyToolbar({
  scrollContainerRef,
  onQuote,
}: SelectionCopyToolbarProps) {
  const toolbarHeight =
    SHELL_INSET * 2 + (onQuote ? CHIP_SIZE * 2 + CHIP_GAP : CHIP_SIZE);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [copied, setCopied] = useState(false);
  const rafRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const serves = toolbar?.serves ?? null;

  useEffect(() => {
    const updateFromSelection = () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        setCopied(false);
        setToolbar(readAssistantSelection(toolbarHeight));
      });
    };

    document.addEventListener("selectionchange", updateFromSelection);
    return () => {
      document.removeEventListener("selectionchange", updateFromSelection);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [toolbarHeight]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(TOOLBAR_SELECTOR)) return;
      if (target.closest(ASSISTANT_SELECTION_SCOPE)) return;
      setToolbar(null);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      window.getSelection()?.removeAllRanges();
      setToolbar(null);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const hideToolbar = () => setToolbar(null);
    const container = scrollContainerRef.current;
    container?.addEventListener("scroll", hideToolbar, { passive: true });
    window.addEventListener("resize", hideToolbar);
    return () => {
      container?.removeEventListener("scroll", hideToolbar);
      window.removeEventListener("resize", hideToolbar);
    };
  }, [scrollContainerRef]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // The served message's hover row yields while the toolbar shows: the
  // key changes only when the toolbar comes, goes or moves to another
  // message, not on every selectionchange.
  useEffect(() => {
    selectionToolbarServes(serves);
    return () => selectionToolbarServes(null);
  }, [serves]);

  const onCopy = async () => {
    if (!toolbar) return;
    try {
      await navigator.clipboard.writeText(toolbar.text);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn("[SelectionCopyToolbar] copy failed", error);
    }
  };

  const onQuoteClick = () => {
    if (!toolbar || !onQuote) return;
    onQuote(toolbar.text);
    // The composer takes the caret; the selection and the chips go.
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
  };

  if (!toolbar) return null;

  return createPortal(
    <SelectionToolbarShell
      side={toolbar.side}
      left={toolbar.left}
      top={toolbar.top}
      copied={copied}
      onCopy={() => void onCopy()}
      onQuote={onQuote && onQuoteClick}
    />,
    document.body,
  );
}

/**
 * The toolbar's look (main chat PRD ruling 108): ONE floating shell
 * holding the hover rows' own chips, so the two read as one family. The
 * chips are `inline` (24px, 14px thin glyph, `ink-muted`, `bg-hover` on
 * hover, the check for 1.5s after a copy, `tabIndex={-1}`); the armour a
 * control needs to cut itself out of the text it lands on is worn once,
 * by the shell: solid `bg-elevated` (no glass), a 1px `line` border and
 * `--shadow-float`, the back-to-bottom button's. Until 2026-10-19 each
 * chip wore it (`floating`): two bordered boxes, another family.
 *
 * - Radius `rounded-md` (12px), the menus' (MessageMenu, the sidebar's
 *   row menus): like a menu it is a surface holding controls with their
 *   own hover ground, and it nests the same way, outer = inner + padding
 *   (the menu's 12 = 8 + 4, here the chip's `rounded-sm` 6 + 6). The
 *   tooltip's 6px fits a label with nothing inside it; around a 6px
 *   chip 6px in, it would be squarer than the chip it holds.
 * - Padding `p-1.5` (6px), chips `gap-0.5` (2px) apart as in a hover
 *   row: a 14px glyph sits 5px inside its 24px chip, so the glyphs are
 *   12px apart (5 + 2 + 5), as in the row, and 12px from the shell's
 *   outer edge (5 + 6 + 1): the row's rhythm, closed into a box.
 * - 38px wide, 64px tall (38 with copy alone); SelectionCopyToolbar's
 *   constants follow from these.
 *
 * Exported for its test; SelectionCopyToolbar portals it.
 */
export function SelectionToolbarShell({
  side,
  left,
  top,
  copied,
  onCopy,
  onQuote,
}: {
  side: ToolbarSide;
  left: number;
  top: number;
  copied: boolean;
  onCopy: () => void;
  /** Without it the shell holds copy alone. */
  onQuote?: () => void;
}) {
  const copy = useCopy();
  const tooltipSide = side === "left" ? "left" : "right";
  return (
    <div
      data-selection-copy-toolbar
      // A press on the shell between the chips keeps the selection, as
      // one on a chip does.
      onMouseDown={preventMouseFocus}
      className={cn(
        "fixed z-[70] flex flex-col gap-0.5 rounded-md border border-line bg-elevated p-1.5 shadow-[var(--shadow-float)]",
        side === "left" && "-translate-x-full",
      )}
      style={{ left, top }}
    >
      <ActionChip
        active={copied}
        idleIcon={<Copy size={14} weight="thin" />}
        activeIcon={<Check size={14} weight="bold" />}
        idleLabel={copy.conversation.copySelection}
        activeLabel={copy.conversation.copied}
        onClick={onCopy}
        tooltipSide={tooltipSide}
      />
      {onQuote && (
        <ActionChip
          active={false}
          idleIcon={<Quotes size={14} weight="thin" />}
          activeIcon={<Quotes size={14} weight="thin" />}
          idleLabel={copy.conversation.quoteSelection}
          activeLabel={copy.conversation.quoteSelection}
          onClick={onQuote}
          tooltipSide={tooltipSide}
        />
      )}
    </div>
  );
}

function readAssistantSelection(toolbarHeight: number): ToolbarState | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const text = selection.toString().trim();
  if (!text) return null;

  const range = selection.getRangeAt(0);
  const scope = selectedAssistantScope(range);
  if (!scope) return null;

  const rect = selectionRect(range);
  if (!rect) return null;

  const scopeRect = scope.getBoundingClientRect();
  const side = toolbarSide(scopeRect);
  const left =
    side === "left"
      ? scopeRect.left - TOOLBAR_GUTTER_GAP
      : side === "right"
        ? scopeRect.right + TOOLBAR_GUTTER_GAP
        : VIEWPORT_GAP;
  // Copy's middle on the selection's last line.
  const top = clampToolbarTop(
    rect.top + rect.height / 2 - COPY_MIDDLE,
    toolbarHeight,
  );
  const serves =
    scope
      .closest(SELECTION_YIELD_REGION)
      ?.getAttribute("data-selection-yield") ?? null;

  return { text, left, top, side, serves };
}

function selectedAssistantScope(range: Range): Element | null {
  const startScope = closestAssistantScope(range.startContainer);
  const endScope = closestAssistantScope(range.endContainer);
  return startScope && startScope === endScope ? startScope : null;
}

function closestAssistantScope(node: Node): Element | null {
  const element =
    node instanceof Element
      ? node
      : node.parentNode instanceof Element
        ? node.parentNode
        : null;
  return element?.closest(ASSISTANT_SELECTION_SCOPE) ?? null;
}

function selectionRect(range: Range): DOMRect | null {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  if (rects.length > 0) return rects[rects.length - 1];

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

function toolbarSide(scopeRect: DOMRect): ToolbarSide {
  if (
    window.innerWidth - scopeRect.right >=
    TOOLBAR_WIDTH + VIEWPORT_GAP + TOOLBAR_GUTTER_GAP
  ) {
    return "right";
  }
  if (scopeRect.left >= TOOLBAR_WIDTH + VIEWPORT_GAP + TOOLBAR_GUTTER_GAP) {
    return "left";
  }
  return "viewport-left";
}

function clampToolbarTop(top: number, toolbarHeight: number): number {
  const min = VIEWPORT_GAP;
  const max = Math.max(min, window.innerHeight - VIEWPORT_GAP - toolbarHeight);
  return Math.min(max, Math.max(min, top));
}
