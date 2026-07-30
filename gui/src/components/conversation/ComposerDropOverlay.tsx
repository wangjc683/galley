import { Paperclip } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";

/**
 * Drag-and-drop affordance covering the Composer while a file drag is
 * over the window (native drag events; rendered while `isDropActive`).
 * Files can always be dropped (they become path references); the copy
 * only varies on whether images additionally attach on this runtime.
 */
export function ComposerDropOverlay({
  imagesEnabled,
}: {
  imagesEnabled: boolean;
}) {
  const copy = useCopy();
  return (
    <div
      // Purely visual: pointer-events-none keeps the overlay out of
      // hit-testing (drop delivery is native and window-level anyway).
      className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-brand/60 bg-brand-soft/85 text-center text-brand-strong"
    >
      <Paperclip size={20} weight="bold" />
      <span className="text-[13px] font-medium">
        {imagesEnabled
          ? copy.composer.dropToAttach
          : copy.composer.dropFilesOnly}
      </span>
    </div>
  );
}
