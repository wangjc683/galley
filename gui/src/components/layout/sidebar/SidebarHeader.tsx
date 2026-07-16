import { PlugsConnected } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { IconTooltip } from "@/components/ui/tooltip";
import { useCopy, type AppCopy } from "@/lib/i18n";
import { isMac, isWindowActionTarget } from "@/lib/platform";
import { cn } from "@/lib/utils";

import type { RuntimeIndicatorView, SidebarRuntimeIndicator } from "./types";

// ---------- subcomponents ----------

export function SidebarHeader({
  runtimeIndicator,
  onOpenRuntimeSettings,
  onOpenModelsSettings,
  onOpenAgentSettings,
}: {
  runtimeIndicator: SidebarRuntimeIndicator;
  onOpenRuntimeSettings?: () => void;
  onOpenModelsSettings?: () => void;
  onOpenAgentSettings?: () => void;
}) {
  const copy = useCopy();
  // Single-line header (refactored 2026-05-13): the "Galley" wordmark
  // is short (~50px at 16px serif), leaving room to right-align the
  // runtime status indicator on the same row and reclaim one line of
  // vertical space for the session list below.
  //
  // This is now the TOP-MOST chrome of the Sidebar column (the old
  // full-width TopBar is gone — each column grows its own header; see
  // MainHeader.tsx). On macOS the traffic lights float at {16,16} over
  // this row (cluster right edge ~68px), so the left padding reserves
  // ~88px: ~20px of clearance so the "Galley" wordmark reads as a
  // deliberate brand placement rather than crowding the OS lights. A
  // flush ~10px gap made the italic serif look jammed against the
  // colored dots — do NOT drop back toward 78px. The header is h-11
  // (44px) to match MainHeader so both column headers' bottom borders
  // align into one continuous top strip; the header content is
  // items-center at ~22px. The lights are nudged to `trafficLightPosition
  // y=22` (tauri.conf.json) so their center lands on that same ~22px row
  // — the default y=16 rendered the lights visibly higher than the
  // wordmark / Supervisor-SOP text. We move the lights, not the text:
  // the text's center is shared with the right column's MainHeader (which
  // has no lights), so nudging text up would break the two-column top
  // strip. Carries `data-tauri-drag-region` + the
  // Windows double-click-maximize handler so this header is a window
  // drag handle just like MainHeader.
  //
  // Narrow widths (min window 960px × 14% sidebar ≈ 134px): the 88px
  // reserve eats most of the row; the wordmark stays visible and the
  // runtime indicator truncates via its existing max-w / truncate.
  const runtimeIndicatorView = renderRuntimeIndicator(
    runtimeIndicator,
    copy.sidebar,
  );
  const indicator =
    runtimeIndicator === "external-ready" ? null : runtimeIndicatorView;
  const externalRuntimeBadge =
    runtimeIndicator === "external-ready" ? runtimeIndicatorView : null;
  const supervisorSopLabel = copy.sidebar.supervisorSop;
  const supervisorSopTooltip = copy.sidebar.supervisorSopTooltip;
  const showSupervisorSop =
    (runtimeIndicator === "hidden" || runtimeIndicator === "external-ready") &&
    Boolean(onOpenAgentSettings);
  return (
    <div
      data-tauri-drag-region
      // Windows custom chrome: double-click anywhere draggable on this
      // header toggles maximize, mirroring native title-bar behavior.
      // Mac's Overlay style hands this to the OS, so we early-exit.
      onDoubleClick={(e) => {
        if (isMac) return;
        if (!isWindowActionTarget(e.target)) return;
        try {
          void getCurrentWindow().toggleMaximize();
        } catch {
          // No Tauri host (plain Vite browser dev) — ignore.
        }
      }}
      className={cn(
        "flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line/60 pr-4",
        // macOS: clear the traffic-light cluster (right edge ~68px) with
        // ~20px of breathing room so the wordmark reads as a deliberate
        // brand mark, not something crowding the OS lights. Non-mac has
        // no native left chrome, so a normal 16px gutter.
        isMac ? "pl-[88px]" : "pl-4",
      )}
    >
      {/* Product mark: sentence-case Galley keeps the name legible as
          a product rather than an acronym. */}
      {/* data-tauri-drag-region is non-bubbling (must be on the exact
          mousedown target), so the wordmark and the badge carry it
          explicitly — grabbing "Galley" next to the traffic lights is
          the most natural window-drag spot in this column. */}
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
        <div
          data-tauri-drag-region
          className="shrink-0 font-serif text-[17px] font-medium italic tracking-[0.005em] text-ink"
        >
          Galley
        </div>
        {externalRuntimeBadge ? (
          <IconTooltip text={externalRuntimeBadge.title} side="bottom">
            <div
              data-tauri-drag-region
              className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-soft"
            >
              <RuntimeDot tone={externalRuntimeBadge.tone} />
              <span data-tauri-drag-region className="min-w-0 truncate">
                {externalRuntimeBadge.label}
              </span>
            </div>
          </IconTooltip>
        ) : null}
      </div>
      {indicator?.action === "models" ? (
        <IconTooltip text={indicator.title} side="bottom">
          <button
            type="button"
            onClick={onOpenModelsSettings}
            aria-label={indicator.ariaLabel}
            className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-[11.5px] text-ink-soft hover:bg-hover hover:text-ink"
          >
            <RuntimeDot tone={indicator.tone} />
            <span className="min-w-0 truncate">{indicator.label}</span>
          </button>
        </IconTooltip>
      ) : indicator?.action === "runtime" ? (
        <IconTooltip text={indicator.title} side="bottom">
          <button
            type="button"
            onClick={onOpenRuntimeSettings}
            aria-label={indicator.ariaLabel}
            className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-[11.5px] text-ink-soft hover:bg-hover hover:text-ink"
          >
            <RuntimeDot tone={indicator.tone} />
            <span className="min-w-0 truncate">{indicator.label}</span>
          </button>
        </IconTooltip>
      ) : showSupervisorSop ? (
        <IconTooltip text={supervisorSopTooltip} side="bottom">
          <button
            type="button"
            onClick={onOpenAgentSettings}
            aria-label={copy.sidebar.openSupervisorSop}
            className="inline-flex min-w-0 max-w-[132px] items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[11.5px] text-ink-soft hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <PlugsConnected size={13} weight="thin" className="shrink-0" />
            <span className="min-w-0 truncate">{supervisorSopLabel}</span>
          </button>
        </IconTooltip>
      ) : indicator ? (
        <IconTooltip text={indicator.title} side="bottom">
          <div
            data-tauri-drag-region
            className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-soft"
          >
            <RuntimeDot tone={indicator.tone} />
            <span data-tauri-drag-region className="min-w-0 truncate">
              {indicator.label}
            </span>
          </div>
        </IconTooltip>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}

function renderRuntimeIndicator(
  indicator: SidebarRuntimeIndicator,
  copy: AppCopy["sidebar"],
): RuntimeIndicatorView | null {
  switch (indicator) {
    case "configure-models":
      return {
        label: copy.configureModels,
        title: copy.bundledNeedsModel,
        ariaLabel: copy.openModelsForBundled,
        tone: "muted",
        action: "models",
      };
    case "external-ready":
      return {
        label: copy.externalGA,
        title: copy.usingExternalGA,
        ariaLabel: copy.usingExternalGAAria,
        tone: "success",
      };
    case "external-unconfigured":
      return {
        label: copy.connectExternalGA,
        title: copy.chooseExistingGAFolder,
        ariaLabel: copy.openRuntimeForExternal,
        tone: "muted",
        action: "runtime",
      };
    case "hidden":
      return null;
  }
}

function RuntimeDot({ tone }: { tone: RuntimeIndicatorView["tone"] }) {
  const map: Record<RuntimeIndicatorView["tone"], string> = {
    success: "bg-success ring-2 ring-success/20",
    muted: "bg-ink-muted",
  };
  // shrink-0: inside min-w-0 truncating rows the dot is otherwise the
  // only shrinkable item left once the label hits zero — at 14%
  // sidebar width the status dot itself deformed.
  return <span className={cn("size-2 shrink-0 rounded-full", map[tone])} />;
}
