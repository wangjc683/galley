import { useEffect, type ReactNode } from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  useGroupRef,
} from "react-resizable-panels";

import {
  DEFAULT_PANEL_LAYOUT,
  registerPanelLayoutReset,
  resetPanelLayout,
} from "@/lib/layout-reset";

/**
 * Full app shell:
 *
 *   ┌──────────┬─┬────────────────────────────────────────────────┐
 *   │ SbHeader │ │ MainHeader     ← each column has its own 44px   │
 *   │──────────│ │────────────────  header (draggable); no longer  │
 *   │ Sidebar  │↕│ Main             one full-width top bar         │
 *   │ (~20%)   │ │ (~80%)                                          │
 *   └──────────┴─┴────────────────────────────────────────────────┘
 *
 * There is no full-width top bar. Each column grows its own header
 * inside its panel (SidebarHeader / MainHeader), so the headers inherit
 * the resizable panel widths and the resize separator runs full-height
 * between them. The two headers are the same height; their bottom
 * borders align into one continuous top strip across the two-tone
 * columns (Sidebar bg-chrome, Main bg-app).
 *
 * Resizable two-column layout via react-resizable-panels v4 (`Group`
 * + `Panel` + `Separator`). Widths are persisted to localStorage via
 * `useDefaultLayout` so layout survives across runs; the curated
 * default split (20/80) is reachable on demand instead — separator
 * double-click, Window menu, or command palette (see
 * lib/layout-reset.ts and devlog 2026-07-30). Percentages (not
 * pixels) so it scales gracefully across window sizes; the desktop
 * minimum window is 960px (Tauri config).
 *
 * Constraints:
 *   - Sidebar  14–30%  (≈ 134–444px across supported widths)
 *   - Main     ≥ 40%
 *
 * **Why no right pane**: the previous Inspector (right-side Details /
 * Approvals / Runtime tabs) was retired 2026-05-12. Each of its tabs
 * duplicated information already accessible elsewhere (ToolCallout
 * cards in the conversation, ApprovalDock for pending, Settings →
 * Runtime/Approval for metadata and audit log). Reclaiming the
 * 14–30% horizontal space gave the conversation column proper
 * breathing room; the app reads as a focused chat product rather
 * than an IDE clone. Memory Inspector (V0.2 PRD) — if it lands —
 * gets a fresh design, not a reuse of this slot.
 *
 * macOS traffic light is positioned at {16, 22} via tauri.conf.json
 * `titleBarStyle: "Overlay"`; it floats above the window's top-left,
 * which is now the Sidebar column's header (SidebarHeader). That header
 * reserves ~88px left padding to clear the lights; the y=22 inset drops
 * the lights onto the header's ~22px content center so they line up with
 * the wordmark instead of sitting high. The Windows custom window
 * controls live at the right of MainHeader (= window top-right).
 *
 * `overflow-hidden` on `<aside>` and `<main>` Panel children locks
 * scrolling to each section's own internal container (Sidebar bucket
 * list, conversation column) — prevents the whole column from
 * scrolling when content overflows, which would otherwise push
 * Composer out of view.
 *
 * Sidebar is intentionally non-collapsible. The dragable separator
 * (ResizeSeparator below) lets users shrink it down to 14% if they
 * want less chrome; full collapse was considered and rejected on
 * 2026-05-13 — sidebar is the physical embodiment of multi-session,
 * which is the product's core differentiator. Hiding it hides the
 * value prop. See devlog for the full reasoning.
 */
export function AppShell({
  sidebar,
  main,
}: {
  sidebar: ReactNode;
  main: ReactNode;
}) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "ga-workbench-layout-2col-v2",
    panelIds: ["sidebar", "main"],
  });
  // Imperative handle for "Reset to Default Layout": registered in the
  // module-level slot so out-of-tree callers (menu event handler,
  // command palette) reach it without a prop path. onLayoutChanged
  // fires on setLayout too, so the reset value persists like a drag.
  const groupRef = useGroupRef();
  useEffect(
    () =>
      registerPanelLayoutReset(() => {
        groupRef.current?.setLayout(DEFAULT_PANEL_LAYOUT);
      }),
    [groupRef],
  );
  return (
    <div className="flex h-screen min-h-[600px] w-screen min-w-[960px] flex-col bg-app text-ink">
      <Group
        id="ga-workbench-layout-2col-v2"
        orientation="horizontal"
        groupRef={groupRef}
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="flex min-h-0 flex-1"
      >
        <Panel id="sidebar" defaultSize="20%" minSize="14%" maxSize="30%">
          <aside className="flex h-full flex-col overflow-hidden border-r border-line/70 bg-chrome">
            {sidebar}
          </aside>
        </Panel>
        <ResizeSeparator />
        <Panel id="main" defaultSize="80%" minSize="40%">
          <main className="flex h-full min-w-0 flex-col overflow-hidden bg-app">
            {main}
          </main>
        </Panel>
      </Group>
    </div>
  );
}

/**
 * Resize handle: a 1px-wide visible line with a 6px-wide invisible
 * hit zone around it. The hit zone makes the pointer target friendly
 * (1px alone is unhittable) without thickening the divider visually.
 * On hover and during drag (`:active`) the line tints to brand,
 * matching the apricot accent we use for other interactive
 * affordances (DESIGN.md §2.1).
 *
 * Double-click resets the split to the curated 20/80 — the established
 * divider convention (spreadsheet column edges, IDE splitters) and the
 * zero-chrome answer to "one-click back to the golden split". Split
 * only: window geometry stays put (that's the full reset's job, Window
 * menu / command palette).
 */
function ResizeSeparator() {
  return (
    <Separator
      onDoubleClick={resetPanelLayout}
      className="group relative w-1.5 shrink-0 cursor-col-resize"
    >
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line/70 group-hover:bg-brand group-active:bg-brand" />
    </Separator>
  );
}
