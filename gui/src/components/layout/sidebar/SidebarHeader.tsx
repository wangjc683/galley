import { getCurrentWindow } from "@tauri-apps/api/window";

import { isMac, isWindowActionTarget } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/session";

import { SIDEBAR_HEADER_PR } from "./sidebar-width";
import { SidebarNavIcons } from "./SidebarNavIcons";

export function SidebarHeader({
  onSearch,
  onOpenScheduled,
  scheduledActionCount,
  projects,
  onNewProject,
  onOpenProject,
}: {
  onSearch?: () => void;
  onOpenScheduled?: () => void;
  scheduledActionCount?: number;
  projects: Project[];
  onNewProject?: () => void;
  onOpenProject?: (id: string) => void;
}) {
  // Masthead row (2026-10-03): the "Galley" wordmark left, 搜索 / 定时 /
  // 项目 as 28px icons right — the same TopBarIconButton rhythm as
  // MainHeader's utility cluster, so the two column headers read as one
  // top strip. The engine indicator and Supervisor SOP that used to sit
  // here moved to MainHeader's status / utility clusters.
  //
  // This is the TOP-MOST chrome of the Sidebar column (the old
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
  // wordmark. We move the lights, not the text: the text's center is
  // shared with the right column's MainHeader (which has no lights), so
  // nudging text up would break the two-column top strip. Carries
  // `data-tauri-drag-region` + the Windows double-click-maximize handler
  // so this header is a window drag handle just like MainHeader.
  //
  // Right padding puts the 项目 icon over the session rows' `⋯` column
  // (Windows adds the list's scrollbar lane). Narrow widths: once the
  // wordmark and the icons no longer fit (251px on mac, 189 / 179px
  // elsewhere — sidebar-width.ts), the icons drop into the new-chat row
  // below and this header is the wordmark alone.
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
        "flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line/60",
        SIDEBAR_HEADER_PR,
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
          mousedown target), so the wordmark carries it explicitly —
          grabbing "Galley" next to the traffic lights is the most
          natural window-drag spot in this column. */}
      <div
        data-tauri-drag-region
        className="shrink-0 font-serif text-[17px] font-medium italic tracking-[0.005em] text-ink"
      >
        Galley
      </div>
      <SidebarNavIcons
        placement="header"
        onSearch={onSearch}
        onOpenScheduled={onOpenScheduled}
        scheduledActionCount={scheduledActionCount}
        projects={projects}
        onNewProject={onNewProject}
        onOpenProject={onOpenProject}
      />
    </div>
  );
}
