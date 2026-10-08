import { describe, expect, it } from "vitest";

import {
  INITIAL_PROJECTS_COLLAPSED,
  projectsCollapsedReducer as reduce,
} from "@/hooks/useSidebarProjectsCollapsed";

describe("projectsCollapsedReducer", () => {
  it("starts expanded and takes the stored value when nothing happened", () => {
    expect(INITIAL_PROJECTS_COLLAPSED.collapsed).toBe(false);
    const loaded = reduce(INITIAL_PROJECTS_COLLAPSED, {
      type: "loaded",
      stored: true,
    });
    expect(loaded).toMatchObject({ collapsed: true, loaded: true });
  });

  it("keeps a click made before the stored value arrives", () => {
    const clicked = reduce(INITIAL_PROJECTS_COLLAPSED, {
      type: "set",
      collapsed: true,
    });
    const loaded = reduce(clicked, { type: "loaded", stored: false });
    expect(loaded).toMatchObject({ collapsed: true, loaded: true });
  });

  it("keeps an early open over a stored collapse", () => {
    // Folded, then opened again (e.g. a reveal) — all before the read.
    const folded = reduce(INITIAL_PROJECTS_COLLAPSED, {
      type: "set",
      collapsed: true,
    });
    const opened = reduce(folded, { type: "set", collapsed: false });
    const loaded = reduce(opened, { type: "loaded", stored: true });
    expect(loaded).toMatchObject({ collapsed: false, loaded: true });
  });

  it("falls back to expanded when the read fails", () => {
    const loaded = reduce(INITIAL_PROJECTS_COLLAPSED, {
      type: "loaded",
      stored: undefined,
    });
    expect(loaded).toMatchObject({ collapsed: false, loaded: true });
  });

  it("ignores a second read and follows clicks after loading", () => {
    const loaded = reduce(INITIAL_PROJECTS_COLLAPSED, {
      type: "loaded",
      stored: false,
    });
    const clicked = reduce(loaded, { type: "set", collapsed: true });
    expect(clicked.collapsed).toBe(true);
    expect(reduce(clicked, { type: "loaded", stored: false })).toBe(clicked);
  });
});
