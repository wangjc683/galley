import { invoke } from "@tauri-apps/api/core";

import type { Project } from "@/types/session";

import {
  GUI_ORIGIN,
  patchSessionInList,
  projectFromBrief,
  pushWriteFailedToast,
  rollBackSessionWrites,
  rowUndo,
  undoRowWrites,
  type ProjectBriefWire,
  type SessionsSliceCreator,
  type SessionsState,
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

  // The writes below change memory first. When Core refuses, what they
  // changed goes back and an error toast says so (2026-11-10 audit, A7);
  // create, update and assign then reject, so a dialog can stay open and
  // a caller can skip what it does next on success. Delete resolves.
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
  //
  // Core broadcasts every project write, this page's own included
  // (ticket 02d); applying the echo of this page's write changes nothing.

  /** Insert a CLI / supervisor-created project. Merge-replaces if the
   * GUI just created the same id locally. */
  applyExternalProjectCreated: (brief: ProjectBriefWire) => void;
  /** Patch a known project from `project-updated-external`. A field sent
   * as `null` is cleared, one the payload lacks keeps its value. No-op
   * for an unknown id. */
  applyExternalProjectUpdated: (brief: ProjectBriefWire) => void;
  /** Mirror the FK SET NULL detach: drops the project row + nulls
   * `projectId` on any sessions that were attached to it. Clears the
   * active filter if it pointed at this project. */
  applyExternalProjectDeleted: (projectId: string) => void;
}

export const createSessionProjectSlice: SessionsSliceCreator<
  SessionProjectSlice
> = (set, get) => ({
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
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
      }));
      pushWriteFailedToast("createProject", e);
      throw e;
    }
    return next;
  },

  updateProject: async (id, partial) => {
    const now = new Date().toISOString();
    const prev = get().projects.find((p) => p.id === id);
    if (!prev) return;
    const nextRootPath =
      partial.rootPath !== undefined
        ? partial.rootPath?.trim() || undefined
        : prev.rootPath;
    const rootPathWasPatched = Object.prototype.hasOwnProperty.call(
      partial,
      "rootPath",
    );
    const undo = rowUndo(prev, {
      ...partial,
      rootPath: nextRootPath,
      workspaceEnabled: rootPathWasPatched
        ? !!nextRootPath
        : partial.workspaceEnabled !== undefined
          ? partial.workspaceEnabled && !!nextRootPath
          : prev.workspaceEnabled,
      name: partial.name !== undefined ? partial.name.trim() : prev.name,
      updatedAt: now,
    });
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...undo.after } : p,
      ),
    }));
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
      set((state) => {
        const projects = undoRowWrites(state.projects, [undo]);
        return projects ? { projects } : {};
      });
      pushWriteFailedToast("updateProject", e);
      throw e;
    }
  },

  deleteProject: async (id) => {
    const before = get();
    const index = before.projects.findIndex((p) => p.id === id);
    const project = before.projects[index];
    const detachedIds = new Set(
      before.sessions.filter((s) => s.projectId === id).map((s) => s.id),
    );
    const wasFilter = before.activeProjectFilter === id;
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
      // Back where it was: the project, its sessions' link to it, and
      // the filter, each unless something has moved it since.
      set((state) => {
        const out: Partial<SessionsState> = {
          sessions: state.sessions.map((s) =>
            detachedIds.has(s.id) && s.projectId === undefined
              ? { ...s, projectId: id }
              : s,
          ),
        };
        if (project && !state.projects.some((p) => p.id === id)) {
          const projects = state.projects.slice();
          projects.splice(Math.min(index, projects.length), 0, project);
          out.projects = projects;
        }
        if (wasFilter && state.activeProjectFilter === undefined) {
          out.activeProjectFilter = id;
        }
        return out;
      });
      pushWriteFailedToast("deleteProject", e);
    }
  },

  assignSessionToProject: async (sessionId, projectId) => {
    const prev = get().sessions.find((s) => s.id === sessionId);
    if (!prev) return;
    const undo = rowUndo(prev, {
      projectId: projectId ?? undefined,
      updatedAt: new Date().toISOString(),
    });
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        undo.after,
      );
      return changed ? { sessions } : {};
    });
    try {
      await invoke("assign_session_to_project", {
        sessionId,
        projectId,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      rollBackSessionWrites(set, [undo], "assignSessionToProject", e);
      throw e;
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

  applyExternalProjectUpdated: (brief) => {
    set((state) => {
      const idx = state.projects.findIndex((p) => p.id === brief.id);
      if (idx === -1) return {};
      const p = state.projects[idx];
      const sent = (key: keyof ProjectBriefWire) =>
        Object.prototype.hasOwnProperty.call(brief, key);
      const next: Project = {
        ...p,
        name: brief.name,
        rootPath: sent("rootPath") ? (brief.rootPath ?? undefined) : p.rootPath,
        workspaceEnabled: brief.workspaceEnabled ?? p.workspaceEnabled,
        icon: sent("icon") ? (brief.icon ?? undefined) : p.icon,
        color: sent("color") ? (brief.color ?? undefined) : p.color,
        pinned: brief.pinned,
        lastActivityAt: brief.lastActivityAt,
        createdAt: brief.createdAt,
        updatedAt: brief.updatedAt,
      };
      const keys = Object.keys(next) as (keyof Project)[];
      if (keys.every((k) => next[k] === p[k])) return {};
      const projects = state.projects.slice();
      projects[idx] = next;
      return { projects };
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
