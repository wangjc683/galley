import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus } from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";

import { Button, type ButtonVariant } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  MANAGED_MODEL_PROVIDER_PRESETS,
  type ManagedModelProviderPreset,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import {
  providerPresetDescription,
  providerPresetLabel,
} from "@/lib/managed-model-preset-copy";
import {
  NO_SCROLL_EDGES,
  nextScrollEdges,
  scrollEdges,
} from "@/lib/scroll-edges";
import { cn } from "@/lib/utils";

interface ManagedModelProviderAddMenuProps {
  variant: ButtonVariant;
  /** Asked before the menu opens; false keeps it shut. Settings refuses
   * while the open provider form holds unsaved input (and flags that
   * form), and otherwise closes the form first. */
  onOpenRequest: () => boolean;
  /** A card was chosen: open its create form. */
  onPick: (presetId: ManagedModelProviderPresetId) => void;
}

/**
 * Settings → 模型's 「添加」 is the card list itself (SIWC decision 16,
 * 2026-10-20): one click opens the presets, in the create form's picker
 * order (「自定义」 last, as in Onboarding's grid), and choosing one
 * opens that card's create form. Esc or a click outside chooses
 * nothing. ↑ / ↓ and Enter are Radix's menu keys. Before, 「添加」
 * opened an empty form whose picker took two more clicks. The
 * zero-provider page has no 「添加」: its form opens by itself and keeps
 * the picker.
 *
 * One line per card, 32px (decision 17): the picker's two-line rows
 * (~52px) fit 7 of 11 in a ~368px-tall menu, the 7th ending exactly at
 * the edge with macOS hiding the scrollbar, so the list looked whole
 * and 「自定义」 — the only way in for relays and local servers — was
 * the one hidden. 11 × 32px + padding is ~362px. A shorter window
 * still scrolls, and fades at the edges say there is more.
 */
export function ManagedModelProviderAddMenu({
  variant,
  onOpenRequest,
  onPick,
}: ManagedModelProviderAddMenuProps) {
  const copy = useCopy().settings.models;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Same boundary as the picker: the Settings dialog, resolved when
  // the list opens, so the list flips / shortens inside the dialog's
  // frame instead of running past its bottom edge.
  const [dialogBoundary, setDialogBoundary] = useState<Element | null>(null);
  // Rows hidden above / below the scroll viewport, read from its
  // scroll position and sizes on scroll and on resize (the observer
  // also fires once on attach, and again when Radix settles the
  // available height). Never set during render or in an effect.
  const [edges, setEdges] = useState(NO_SCROLL_EDGES);
  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setEdges((previous) => nextScrollEdges(previous, scrollEdges(node)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Modal (Radix's default): Settings is a Dialog whose scroll lock
  // swallows wheel events on portaled content; the menu's own lock on
  // top lets the list scroll.
  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          if (!onOpenRequest()) return;
          setDialogBoundary(
            triggerRef.current?.closest('[role="dialog"]') ?? null,
          );
        }
        setOpen(next);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <Button
          ref={triggerRef}
          variant={variant}
          size="sm"
          aria-label={copy.addProviderAria}
          leadingIcon={<Plus size={12} weight="bold" />}
        >
          {copy.addProvider}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionBoundary={dialogBoundary ?? []}
          collisionPadding={12}
          style={{
            maxHeight:
              "min(420px, var(--radix-dropdown-menu-content-available-height))",
          }}
          // The frame stays put and clips; the list scrolls inside it,
          // under the fades.
          className="galley-pop-in relative z-[80] flex w-[320px] flex-col overflow-hidden rounded-sm border border-line bg-elevated shadow-elevated"
        >
          <div
            ref={viewportRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              setEdges((previous) =>
                nextScrollEdges(previous, scrollEdges(node)),
              );
            }}
            // scroll-py: a row reached by ↑ / ↓ stops clear of a fade.
            className="min-h-0 scroll-py-6 overflow-y-auto p-1"
          >
            {MANAGED_MODEL_PROVIDER_PRESETS.map((preset) => (
              <DropdownMenu.Item
                key={preset.id}
                textValue={providerPresetLabel(copy, preset)}
                onSelect={() => onPick(preset.id)}
                className="flex h-8 w-full min-w-0 items-center rounded-sm px-2.5 text-left leading-5 text-ink-soft outline-none data-[highlighted]:bg-hover"
              >
                <PresetMenuRow preset={preset} />
              </DropdownMenu.Item>
            ))}
          </div>
          <EdgeFade edge="top" visible={edges.top} />
          <EdgeFade edge="bottom" visible={edges.bottom} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A card on one line: its name, then its description in the muted
 * style, cut with an ellipsis when it runs out of room (the whole text
 * in the native tooltip). The picker keeps name over description. */
function PresetMenuRow({ preset }: { preset: ManagedModelProviderPreset }) {
  const copy = useCopy().settings.models;
  const description = providerPresetDescription(copy, preset.id);
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="shrink-0 text-ui-secondary font-medium">
        {providerPresetLabel(copy, preset)}
      </span>
      {description && (
        <span
          className="min-w-0 truncate text-ui-tertiary text-ink-muted"
          title={description}
        >
          {description}
        </span>
      )}
    </span>
  );
}

/** 24px from the menu's own surface to transparent, over the list's
 * edge while rows are hidden past it. Decorative, never in the way. */
function EdgeFade({
  edge,
  visible,
}: {
  edge: "top" | "bottom";
  visible: boolean;
}) {
  return (
    <div
      aria-hidden
      data-edge-fade={edge}
      style={{
        background: `linear-gradient(to ${edge === "top" ? "bottom" : "top"}, var(--color-elevated), transparent)`,
      }}
      className={cn(
        "pointer-events-none absolute inset-x-0 h-6 transition-opacity duration-(--motion-fast)",
        edge === "top" ? "top-0" : "bottom-0",
        visible ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
