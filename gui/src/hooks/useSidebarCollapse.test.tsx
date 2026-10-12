import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useSidebarCollapse } from "./useSidebarCollapse";

// Static rendering reads a store's initial state (expanded), so the
// stored choice is fed through the module: collapsed.
vi.mock("@/stores/sidebar-collapse", () => {
  const state = {
    collapsed: true,
    toggle: () => {},
    hydrate: async () => {},
  };
  return {
    useSidebarCollapseStore: <T,>(selector: (s: typeof state) => T) =>
      selector(state),
  };
});

function Probe({ hasMainChat }: { hasMainChat: boolean }) {
  const { collapsed } = useSidebarCollapse(hasMainChat);
  return <i>{collapsed ? "collapsed" : "expanded"}</i>;
}

describe("useSidebarCollapse", () => {
  it("collapses only while there is a main chat", () => {
    expect(renderToStaticMarkup(<Probe hasMainChat />)).toContain("collapsed");
    // The external runtime: the stored choice never hides its sidebar.
    expect(renderToStaticMarkup(<Probe hasMainChat={false} />)).toContain(
      "expanded",
    );
  });
});
