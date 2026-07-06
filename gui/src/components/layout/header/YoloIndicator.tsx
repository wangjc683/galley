import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Lightning } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  TOPBAR_POPOVER_OPEN_STATE,
  topBarStatusBadgeClass,
} from "./topbar-status-badge";

/**
 * Persistent YOLO indicator (DESIGN.md §4.1 / PRD §11.5).
 *
 * Visible only while yoloMode is true. Click → Radix Popover with:
 *   - Status line ("YOLO 模式已开启")
 *   - "立即关闭" warning-tinted button (calls onDisable)
 *   - Secondary link to Settings → Approval tab
 *
 * Visual: warning-tinted text badge using the shared TopBar status
 * style. Hover/open use the shared TopBar control rhythm, but there is
 * no looping animation — users tune out blinking; static colour reads
 * "this is a state, be aware" without becoming background noise.
 */
export function YoloIndicator({
  onDisable,
  onOpenSettings,
}: {
  onDisable?: () => void;
  onOpenSettings?: () => void;
}) {
  const copy = useCopy();
  return (
    <Popover.Root>
      <TooltipLabel text={copy.topbar.yoloTooltip} side="bottom">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={copy.topbar.yoloView}
            className={topBarStatusBadgeClass(
              "warning",
              cn(
                "uppercase tracking-[0.04em] hover:-translate-y-px hover:border-warning hover:bg-warning hover:text-elevated hover:shadow-[var(--shadow-button-raised-hover)]",
                TOPBAR_POPOVER_OPEN_STATE,
                "data-[state=open]:border-warning data-[state=open]:bg-warning data-[state=open]:text-elevated",
              ),
            )}
          >
            YOLO
          </button>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className={cn(
            "galley-pop-in z-50 w-[280px] overflow-hidden rounded-md border border-warning/30 bg-elevated shadow-elevated",
          )}
        >
          {/* Caution header band mirrors the shared warning badge while
              using Lightning inside the expanded risk surface. The
              collapsed TopBar badge stays text-only. */}
          <div className="flex items-center gap-2 border-b border-warning/20 bg-warning/[var(--opacity-subtle)] px-4 py-3">
            <Lightning size={16} weight="thin" className="text-warning" />
            <div className="text-[13px] font-medium text-ink">
              {copy.topbar.yoloOn}
            </div>
          </div>
          <div className="p-4">
            <p className="text-[12px] leading-[1.55] text-ink-muted">
              {copy.topbar.yoloDetail}
            </p>
            <Button
              variant="warning"
              size="md"
              onClick={onDisable}
              className="mt-3 w-full"
            >
              {copy.topbar.turnOffNow}
            </Button>
            {onOpenSettings && (
              <Popover.Close asChild>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={onOpenSettings}
                  className="mt-2 w-full"
                  trailingIcon={<ArrowRight size={12} weight="thin" />}
                >
                  {copy.topbar.viewInSettings}
                </Button>
              </Popover.Close>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
