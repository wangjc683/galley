import { useEffect, useReducer } from "react";

import { getPref, setPref } from "@/lib/db";

/** Pref key for the sidebar 项目 section's collapsed state (S2). */
export const SIDEBAR_PROJECTS_COLLAPSED_PREF = "sidebar_projects_collapsed";

export interface ProjectsCollapsedState {
  collapsed: boolean;
  /** The stored value has been read (or failed to read); from then on
   * every change is written back. */
  loaded: boolean;
  /** The section was folded or opened before the stored value arrived. */
  changedBeforeLoad: boolean;
}

export type ProjectsCollapsedAction =
  | { type: "set"; collapsed: boolean }
  | { type: "loaded"; stored: boolean | undefined };

export const INITIAL_PROJECTS_COLLAPSED: ProjectsCollapsedState = {
  collapsed: false,
  loaded: false,
  changedBeforeLoad: false,
};

/**
 * The stored value only fills in the default: a click (or a reveal
 * opening the section) that lands before the read returns wins over it,
 * so a slow first read never flips the section under the user.
 */
export function projectsCollapsedReducer(
  state: ProjectsCollapsedState,
  action: ProjectsCollapsedAction,
): ProjectsCollapsedState {
  if (action.type === "set") {
    if (action.collapsed === state.collapsed) return state;
    return {
      ...state,
      collapsed: action.collapsed,
      changedBeforeLoad: state.changedBeforeLoad || !state.loaded,
    };
  }
  if (state.loaded) return state;
  return {
    ...state,
    loaded: true,
    collapsed: state.changedBeforeLoad
      ? state.collapsed
      : action.stored === true,
  };
}

/**
 * Whether the sidebar 项目 section is collapsed (S2): expanded by
 * default, remembered across launches. Read once on mount; every change
 * after that is written back, whoever made it — the header's caret, or
 * the sidebar opening the section to reveal a project.
 */
export function useSidebarProjectsCollapsed(): [
  boolean,
  (collapsed: boolean) => void,
] {
  const [state, dispatch] = useReducer(
    projectsCollapsedReducer,
    INITIAL_PROJECTS_COLLAPSED,
  );

  useEffect(() => {
    let cancelled = false;
    getPref<boolean>(SIDEBAR_PROJECTS_COLLAPSED_PREF)
      .then((stored) => {
        if (!cancelled) dispatch({ type: "loaded", stored });
      })
      .catch(() => {
        // No Tauri host (plain Vite) or a read error: keep the default,
        // and still let later changes persist.
        if (!cancelled) dispatch({ type: "loaded", stored: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { collapsed, loaded } = state;
  useEffect(() => {
    if (!loaded) return;
    void setPref(SIDEBAR_PROJECTS_COLLAPSED_PREF, collapsed).catch(() => {});
  }, [collapsed, loaded]);

  return [
    collapsed,
    (next: boolean) => dispatch({ type: "set", collapsed: next }),
  ];
}
