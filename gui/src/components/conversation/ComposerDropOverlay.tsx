import { Paperclip } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Drag-and-drop affordance covering the Composer while a file drag is
 * over it. The container renders this only while its drag counter says
 * the drop is active.
 */
export function ComposerDropOverlay({
  imagesEnabled,
}: {
  imagesEnabled: boolean;
}) {
  const copy = useCopy();
  return (
    <div
      // Purely visual: pointer-events-none lets the drag events
      // reach the elements beneath, so the enter/leave counter
      // stays balanced and the drop still lands on this container.
      className={cn(
        "pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-center",
        imagesEnabled
          ? "border-brand/60 bg-brand-soft/85 text-brand-strong"
          : "border-line bg-surface/85 text-ink-muted",
      )}
    >
      {imagesEnabled && <Paperclip size={20} weight="bold" />}
      <span className="text-[13px] font-medium">
        {imagesEnabled
          ? copy.composer.dropToAttach
          : copy.composer.dropUnavailable}
      </span>
    </div>
  );
}
