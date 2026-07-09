import * as Popover from "@radix-ui/react-popover";
import { TextAa } from "@phosphor-icons/react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import type { ConversationFontSize } from "@/lib/conversation-font-size";

import { TopBarIconButton } from "../TopBarIconButton";

/**
 * Conversation font-size control.
 *
 * Trigger: fixed-size TextAa icon button; current tier lives in the
 * tooltip and the popover, never on the button face. (Earlier designs
 * scaled a custom "A" glyph with the tier — a ~2px difference is
 * unreadable as state and made the icon jump on change — then tried a
 * persistent brand tint for non-default tiers, which turned a settled
 * preference into standing chrome noise.)
 *
 * Panel: a Popover (not DropdownMenu) on purpose — it stays open after
 * a pick so the user can flip through tiers and watch the conversation
 * re-render live, then dismiss. Content is the shared SegmentedControl,
 * matching how three-way choices look everywhere else in the app.
 */
export function ConversationFontSizeMenu({
  value,
  onChange,
}: {
  value: ConversationFontSize;
  onChange?: (size: ConversationFontSize) => void;
}) {
  const copy = useCopy().topbar.conversationFontSize;
  const selectedLabel = fontSizeLabel(copy, value);

  return (
    <Popover.Root>
      <TooltipLabel text={selectedLabel}>
        <Popover.Trigger asChild>
          <TopBarIconButton aria-label={selectedLabel}>
            <TextAa size={16} weight="thin" />
          </TopBarIconButton>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={6}
          onOpenAutoFocus={(event) => {
            // Radix autofocuses the first segment on open, painting a
            // focus ring on 小 even when a later tier is selected — a
            // false highlight that fought the real selection (the orange
            // thumb) and clipped against the tight track. Pointer-open
            // needs no ring; the thumb already shows the current tier.
            // Keyboard users can still Tab / arrow into the segments.
            event.preventDefault();
          }}
          className="galley-pop-in z-[70] rounded-md border border-line bg-elevated p-1.5 shadow-elevated"
        >
          <SegmentedControl
            value={value}
            ariaLabel={copy.aria}
            onValueChange={(size) => onChange?.(size)}
            options={[
              // No per-segment tooltips: the labels are self-evident.
              { value: "small", label: copy.smallShort },
              { value: "standard", label: copy.standardShort },
              { value: "large", label: copy.largeShort },
            ]}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function fontSizeLabel(
  copy: ReturnType<typeof useCopy>["topbar"]["conversationFontSize"],
  value: ConversationFontSize,
): string {
  if (value === "small") return copy.small;
  if (value === "large") return copy.large;
  return copy.standard;
}
