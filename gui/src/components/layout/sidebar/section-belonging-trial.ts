import { create } from "zustand";

/**
 * TEMPORARY — the 「其他对话」 section-belonging trial (main chat ticket
 * 09, PRD ruling 37). JC compares three variants live in tauri dev (pill:
 * SectionBelongingSwitcher.tsx) and picks one. Only the sidebar WITH a
 * main chat reads this; the external runtime's sidebar never does, so it
 * is the same in all three.
 *
 * All three share the C1 base, which is not on trial and stays whichever
 * wins (Sidebar.tsx's sectioned branch): only the main-chat row is pinned
 * above the list; the section header is the scrolling list's first
 * element, sticky at its top; the gap above the header is the large one
 * (17px box to box) and the gap to its first child the small one (6px to
 * a label's text box: the `:first-child` rules in SidebarTimeline.tsx /
 * SidebarSideChats.tsx).
 *
 *   C1 — the base alone.
 *   C2 — C1 + the section's children indented 8px (`pl-2` on the
 *        section body): labels, rows, groups, 其他来源, 更早, the
 *        placeholder row and the empty hint move right; the header hangs
 *        on the 18px line.
 *   C3 — C1 + the whole section (header and children) on `bg-app`,
 *        full-bleed; the main-chat row stays on chrome. `app` is the
 *        only existing ground that sits on the far side of chrome from
 *        the sidebar's hover / selected fills in both themes, so both
 *        separate more on it, not less (CIE ΔL*: light app +3.85 over
 *        chrome, hover −7.66 / selected −11.02 on app vs −3.81 / −7.17
 *        on chrome; dark app −2.57, hover +10.29 / selected +18.84 vs
 *        +7.72 / +16.27).
 *
 * The choice is a per-machine convenience in localStorage (wrapped:
 * storage can be unavailable), never in Core.
 *
 * Removal, after the ruling (every trial line says TEMPORARY or
 * "ticket 09 trial"):
 *
 *   Always — delete SectionBelongingSwitcher.tsx and its line in App.tsx;
 *   in Sidebar.tsx replace `sectionBelongingClasses(useSectionBelonging())`
 *   with the winner's three class strings below (inline them on the
 *   section, header and body divs) and drop the import; delete this file;
 *   drop the trial's mock and its "section's belonging" describe block in
 *   Sidebar.main-chat.test.tsx, keeping the winner's assertions as plain
 *   tests (the C1 ones and the external ones always stay).
 *   C1 wins — the three strings are `""`, `"bg-chrome"`, `""`.
 *   C2 wins — as C1, body `"pl-2"`; update the grid notes
 *   (layout-and-chrome.md 「侧栏网格」: the section's lines move to
 *   26 / 50px, the right 18px line stays).
 *   C3 wins — section `"bg-app pb-2"`, header `"bg-app"`, body `""`;
 *   write the ground into layout-and-chrome.md with the ΔL* above.
 *   Then the design doc's 「有主对话时」 section (ASCII diagram, the
 *   分区头 bullet, the divider rule) is rewritten for the sticky header.
 */
export type SectionBelonging = "C1" | "C2" | "C3";

export const SECTION_BELONGINGS: readonly SectionBelonging[] = [
  "C1",
  "C2",
  "C3",
];

const STORAGE_KEY = "galley.tmp.sectionBelonging";
const DEFAULT_BELONGING: SectionBelonging = "C1";

function readStored(): SectionBelonging {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return (
      SECTION_BELONGINGS.find((option) => option === stored) ??
      DEFAULT_BELONGING
    );
  } catch {
    return DEFAULT_BELONGING;
  }
}

function writeStored(value: SectionBelonging) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Not remembered across reloads; the switch itself still works.
  }
}

interface SectionBelongingState {
  belonging: SectionBelonging;
  setBelonging: (belonging: SectionBelonging) => void;
}

export const useSectionBelongingStore = create<SectionBelongingState>(
  (set) => ({
    belonging: readStored(),
    setBelonging: (belonging) => {
      writeStored(belonging);
      set({ belonging });
    },
  }),
);

export function useSectionBelonging(): SectionBelonging {
  return useSectionBelongingStore((s) => s.belonging);
}

/** The classes each variant puts on the sectioned list's three
 * wrappers (Sidebar.tsx): the section (header + children), the sticky
 * header's wrapper (its ground: it must be opaque, rows slide under
 * it) and the body (the children). */
export function sectionBelongingClasses(belonging: SectionBelonging): {
  section: string;
  header: string;
  body: string;
} {
  switch (belonging) {
    case "C2":
      return { section: "", header: "bg-chrome", body: "pl-2" };
    case "C3":
      // pb-2: the block's last row doesn't sit on its bottom edge.
      return { section: "bg-app pb-2", header: "bg-app", body: "" };
    default:
      return { section: "", header: "bg-chrome", body: "" };
  }
}
