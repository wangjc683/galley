import { invoke } from "@tauri-apps/api/core";

import { usePrefsStore } from "@/stores/prefs";

import {
  projectFromBrief,
  sessionFromBrief,
  type ProjectBriefWire,
  type SessionBriefWire,
  type SessionsSliceCreator,
} from "./shared";

async function invokeHydrate<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  let lastError: unknown;
  for (const delayMs of [0, 250, 750]) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
    }
    try {
      return await invoke<T>(command, args);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export interface SessionHydrateSlice {
  /** Load sessions + projects from Rust core. Called by the cold-start
   * orchestrator at `lib/hydrate.ts`. Mutates state directly; errors
   * are logged but don't throw — start-empty is a recoverable cold path. */
  hydrate: () => Promise<void>;
}

export const createSessionHydrateSlice: SessionsSliceCreator<
  SessionHydrateSlice
> = (set) => ({
  hydrate: async () => {
    try {
      const activeRuntimeKind = usePrefsStore.getState().activeRuntimeKind;
      const briefs = await invokeHydrate<SessionBriefWire[]>("list_sessions", {
        filter: { runtimeKind: activeRuntimeKind },
      });
      const sessions = briefs.map(sessionFromBrief);
      set((state) => ({
        sessions,
        activeSessionId: sessions.some((s) => s.id === state.activeSessionId)
          ? state.activeSessionId
          : undefined,
      }));
    } catch (e) {
      console.warn("[sessions] hydrate sessions failed.", e);
    }
    try {
      const projects = await invokeHydrate<ProjectBriefWire[]>("list_projects");
      const nextProjects = projects.map(projectFromBrief);
      set((state) => ({
        projects: nextProjects,
        activeProjectFilter:
          state.activeProjectFilter &&
          nextProjects.some((p) => p.id === state.activeProjectFilter)
            ? state.activeProjectFilter
            : undefined,
      }));
    } catch (e) {
      console.debug("[sessions] hydrate projects failed.", e);
    }
  },
});
