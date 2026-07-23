import { invoke } from "@tauri-apps/api/core";

import type { Project } from "@/types/session";

import {
  GUI_ORIGIN,
  patchSessionInList,
  projectFromBrief,
  type ProjectBriefWire,
  type SessionsSliceCreator,
} from "./shared";

interface CreateProjectInputWire {
  id: string;
  name: string;
  rootPath?: string;
  workspaceEnabled?: boolean;
  icon?: string;
  color?: string;
}

export interface SessionProjectSlice {
  projects: Project[];
  activeProjectFilter: string | undefined;

  createProject: (input: {
    name: string;
    rootPath?: string;
    workspaceEnabled?: boolean;
  }) => Promise<Project>;
  updateProject: (
    id: string,
    partial: Partial<
      Pick<Project, "name" | "rootPath" | "workspaceEnabled" | "pinned">
    >,
  ) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  assignSessionToProject: (
    sessionId: string,
    projectId: string | null,
  ) => Promise<void>;
  setActiveProjectFilter: (projectId: string | undefined) => void;

  // ---- B4 M1 · external mirror entry points (project side) ----

  /** Insert a CLI / supervisor-created project. Merge-replaces if the
   * GUI just created the same id locally. */
  applyExternalProjectCreated: (brief: ProjectBriefWire) => void;
  /** Mirror the FK SET NULL detach: drops the project row + nulls
   * `projectId` on any sessions that were attached to it. Clears the
   * active filter if it pointed at this project. */
  applyExternalProjectDeleted: (projectId: string) => void;
}

export const createSessionProjectSlice: SessionsSliceCreator<
  SessionProjectSlice
> = (set) => ({
  projects: [],
  activeProjectFilter: undefined,

  createProject: async ({ name, rootPath }) => {
    const id = `proj_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const now = new Date().toISOString();
    const nextRootPath = rootPath?.trim() || undefined;
    const next: Project = {
      id,
      name: name.trim(),
      rootPath: nextRootPath,
      workspaceEnabled: !!nextRootPath,
      pinned: false,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ projects: [next, ...state.projects] }));
    try {
      await invoke("create_project", {
        input: {
          id,
          name: next.name,
          rootPath: next.rootPath,
          workspaceEnabled: next.workspaceEnabled,
        } as CreateProjectInputWire,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      console.debug("[sessions] create_project invoke failed.", e);
    }
    return next;
  },

  updateProject: async (id, partial) => {
    const now = new Date().toISOString();
    let updated: Project | null = null;
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.id !== id) return p;
        const nextRootPath =
          partial.rootPath !== undefined
            ? partial.rootPath?.trim() || undefined
            : p.rootPath;
        const rootPathWasPatched = Object.prototype.hasOwnProperty.call(
          partial,
          "rootPath",
        );
        updated = {
          ...p,
          ...partial,
          rootPath: nextRootPath,
          workspaceEnabled:
            rootPathWasPatched
              ? !!nextRootPath
              : partial.workspaceEnabled !== undefined
              ? partial.workspaceEnabled && !!nextRootPath
              : p.workspaceEnabled,
          name: partial.name !== undefined ? partial.name.trim() : p.name,
          updatedAt: now,
        };
        return updated;
      }),
    }));
    if (!updated) return;
    try {
      // Translate front-end Partial<Project> into Rust ProjectPatch:
      //   - name: Option<String>           (single Option — empty rejected server-side)
      //   - root_path: Option<Option<String>>
      //   - pinned: Option<bool>
      //
      // Double-Option pattern lets `Some(null)` clear root_path vs
      // `null` (not set, leave alone). The GUI's `partial.rootPath`
      // signal is binary (string or undefined) — we map undefined → omitted,
      // empty/whitespace → Some(null), non-empty → Some(value).
      const patch: Record<string, unknown> = {};
      if (partial.name !== undefined) patch.name = partial.name.trim();
      if (Object.prototype.hasOwnProperty.call(partial, "rootPath")) {
        const trimmed = partial.rootPath?.trim();
        patch.rootPath = trimmed ? trimmed : null;
        patch.workspaceEnabled = !!trimmed;
      } else if (partial.workspaceEnabled !== undefined) {
        patch.workspaceEnabled = partial.workspaceEnabled;
      }
      if (partial.pinned !== undefined) patch.pinned = partial.pinned;
      await invoke("update_project", {
        id,
        patch,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      console.debug("[sessions] update_project invoke failed.", e);
    }
  },

  deleteProject: async (id) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      // FK SET NULL on sessions.project_id; mirror in memory.
      sessions: state.sessions.map((s) =>
        s.projectId === id ? { ...s, projectId: undefined } : s,
      ),
      activeProjectFilter:
        state.activeProjectFilter === id
          ? undefined
          : state.activeProjectFilter,
    }));
    try {
      await invoke("delete_project", { id, origin: GUI_ORIGIN });
    } catch (e) {
      console.debug("[sessions] delete_project invoke failed.", e);
    }
  },

  assignSessionToProject: async (sessionId, projectId) => {
    const now = new Date().toISOString();
    let didUpdate = false;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          didUpdate = true;
          return { ...s, projectId: projectId ?? undefined, updatedAt: now };
        },
      );
      return changed ? { sessions } : {};
    });
    if (!didUpdate) return;
    try {
      await invoke("assign_session_to_project", {
        sessionId,
        projectId,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      console.debug("[sessions] assign_session_to_project invoke failed.", e);
    }
  },

  setActiveProjectFilter: (projectId) =>
    set({ activeProjectFilter: projectId }),

  // ---- B4 M1 · external mirror entry points ----

  applyExternalProjectCreated: (brief) => {
    set((state) => {
      // Race guard: if the GUI just created the same project locally,
      // merge in place rather than duplicating the row.
      const idx = state.projects.findIndex((p) => p.id === brief.id);
      if (idx === -1) {
        return { projects: [projectFromBrief(brief), ...state.projects] };
      }
      const next = state.projects.slice();
      next[idx] = { ...next[idx], ...projectFromBrief(brief) };
      return { projects: next };
    });
  },

  /// Mirror the FK SET NULL detach so the sidebar reflects reality
  /// without a hydrate round-trip. `detachedSessionIds` could be used
  /// to be precise but iterating sessions is cheap and tolerates any
  /// drift between the snapshot the socket handler took and the GUI's
  /// local view.
  applyExternalProjectDeleted: (projectId) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
      sessions: state.sessions.map((s) =>
        s.projectId === projectId ? { ...s, projectId: undefined } : s,
      ),
      activeProjectFilter:
        state.activeProjectFilter === projectId
          ? undefined
          : state.activeProjectFilter,
    }));
  },
});
