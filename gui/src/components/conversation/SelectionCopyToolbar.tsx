import { Check, Copy, Quotes } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { ActionChip } from "@/components/conversation/ActionChip";
import { useCopy } from "@/lib/i18n";
import { SELECTION_COPY_SCOPE as ASSISTANT_SELECTION_SCOPE } from "@/lib/selection-copy";
import { cn } from "@/lib/utils";

const TOOLBAR_SELECTOR = "[data-selection-copy-toolbar]";
const TOOLBAR_WIDTH = 28;
const VIEWPORT_GAP = 12;
const TOOLBAR_GUTTER_GAP = 10;
/** One floating chip (`size-7`). */
const CHIP_SIZE = 28;
/** Between copy and quote (`gap-1`). */
const CHIP_GAP = 4;

interface SelectionCopyToolbarProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /**
   * 「引用」 (telegram-details ticket 02): hand the selected text to the
   * composer as a quote. Without it the toolbar is copy alone.
   */
  onQuote?: (text: string) => void;
}

interface ToolbarState {
  text: string;
  left: number;
  top: number;
  side: "left" | "right" | "viewport-left";
}

/**
 * Floating chips beside a selection in a reply (or, in the assistant's
 * conversation, in your bubble): copy, and quote into the composer. A
 * column in the gutter, copy on top where it always sat (its middle on
 * the selection's last line), quote 4px under it.
 */
export function SelectionCopyToolbar({
  scrollContainerRef,
  onQuote,
}: SelectionCopyToolbarProps) {
  const copy = useCopy();
  const toolbarHeight = onQuote ? CHIP_SIZE * 2 + CHIP_GAP : CHIP_SIZE;
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [copied, setCopied] = useState(false);
  const rafRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

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

  const tooltipSide = toolbar.side === "left" ? "left" : "right";

  return createPortal(
    <div
      data-selection-copy-toolbar
      className={cn(
        "pointer-events-none fixed z-[70] flex flex-col gap-1",
        toolbar.side === "left" && "-translate-x-full",
      )}
      style={{ left: toolbar.left, top: toolbar.top }}
    >
      <ActionChip
        variant="floating"
        active={copied}
        idleIcon={<Copy size={14} weight="thin" />}
        activeIcon={<Check size={14} weight="bold" />}
        idleLabel={copy.conversation.copySelection}
        activeLabel={copy.conversation.copied}
        onClick={() => void onCopy()}
        tooltipSide={tooltipSide}
        className="pointer-events-auto"
      />
      {onQuote && (
        <ActionChip
          variant="floating"
          active={false}
          idleIcon={<Quotes size={14} weight="thin" />}
          activeIcon={<Quotes size={14} weight="thin" />}
          idleLabel={copy.conversation.quoteSelection}
          activeLabel={copy.conversation.quoteSelection}
          onClick={onQuoteClick}
          tooltipSide={tooltipSide}
          className="pointer-events-auto"
        />
      )}
    </div>,
    document.body,
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
  const top = clampToolbarTop(
    rect.top + rect.height / 2 - CHIP_SIZE / 2,
    toolbarHeight,
  );

  return { text, left, top, side };
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

function toolbarSide(scopeRect: DOMRect): ToolbarState["side"] {
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
