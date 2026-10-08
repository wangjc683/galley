import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

import { applyManagedRuntimeDiagnostics } from "@/lib/managed-runtime-diagnostics";
import {
  deleteManagedModelProvider,
  deleteManagedModel,
  getManagedModelDefaults,
  listManagedModelProviders,
  listManagedModels,
  saveManagedModelProvider,
  saveManagedModel,
  setManagedModelDefaults,
  reorderManagedModels,
} from "@/lib/managed-models";
import type { ManagedRuntimeDiagnostics } from "@/types/inspector";
import type {
  ManagedModelRecord,
  ManagedModelProviderRecord,
  SaveManagedModelInput,
  SaveManagedProviderInput,
} from "@/types/managed-models";

interface ManagedModelsState {
  providers: ManagedModelProviderRecord[];
  models: ManagedModelRecord[];
  /** The global defaults layer (`settings.models` → 默认高级配置).
   * Only the user's deviations from the factory recommended values;
   * `{}` means "all recommended". */
  defaults: Record<string, unknown>;
  loading: boolean;
  saving: boolean;
  /** Raw text of the last `load()` failure; null once a load succeeds.
   * Empty when the thrown value carried no text — the store never
   * invents copy, the UI owns the localized fallback. The lists keep
   * whatever the previous successful load put there (stale-while-
   * revalidate), so with this set an empty list says nothing about
   * what is configured. Write failures are not stored: every write
   * action rethrows, and the caller reports it where the action
   * happened (Settings → 模型: an error toast). */
  loadError: string | null;
}

interface ManagedModelsActions {
  load: () => Promise<{
    providers: ManagedModelProviderRecord[];
    models: ManagedModelRecord[];
    defaults: Record<string, unknown>;
    /** Set when the load itself failed — the (empty) lists then say
     * NOTHING about what is configured. Callers deciding "does the
     * user have models?" must branch on this, not on length. */
    loadError: string | null;
  }>;
  saveProvider: (input: SaveManagedProviderInput) => Promise<ManagedModelProviderRecord>;
  deleteProvider: (id: string) => Promise<void>;
  saveModel: (input: SaveManagedModelInput) => Promise<void>;
  saveDefaults: (defaults: Record<string, unknown>) => Promise<void>;
  reorderModels: (modelIds: string[]) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
}

export type ManagedModelsStore = ManagedModelsState & ManagedModelsActions;

export const useManagedModelsStore = create<ManagedModelsStore>((set) => ({
  providers: [],
  models: [],
  defaults: {},
  loading: false,
  saving: false,
  loadError: null,

  load: async () => {
    set({ loading: true, loadError: null });
    try {
      const [providers, models, defaults] = await Promise.all([
        listManagedModelProviders(),
        listManagedModels(),
        getManagedModelDefaults(),
      ]);
      set({ providers, models, defaults, loading: false });
      return { providers, models, defaults, loadError: null };
    } catch (e) {
      const loadError = managedModelsErrorText(e);
      set({ loading: false, loadError });
      // Callers branch on this being truthy (hydrate), so a failure
      // whose thrown value carried no text must still read as one.
      return {
        providers: [],
        models: [],
        defaults: {},
        loadError: loadError || String(e),
      };
    }
  },

  saveProvider: async (input) => {
    set({ saving: true });
    try {
      const provider = await saveManagedModelProvider(input);
      const [providers, models] = await Promise.all([
        listManagedModelProviders(),
        listManagedModels(),
      ]);
      set({ providers, models, saving: false });
      void refreshManagedRuntimeDiagnostics();
      return provider;
    } catch (e) {
      set({ saving: false });
      throw e;
    }
  },

  deleteProvider: async (id) => {
    set({ saving: true });
    try {
      await deleteManagedModelProvider(id);
      const [providers, models] = await Promise.all([
        listManagedModelProviders(),
        listManagedModels(),
      ]);
      set({ providers, models, saving: false });
      void refreshManagedRuntimeDiagnostics();
    } catch (e) {
      set({ saving: false });
      throw e;
    }
  },

  saveModel: async (input) => {
    set({ saving: true });
    try {
      await saveManagedModel(input);
      const models = await listManagedModels();
      set({ models, saving: false });
      void refreshManagedRuntimeDiagnostics();
    } catch (e) {
      set({ saving: false });
      throw e;
    }
  },

  // The defaults layer feeds every model's effective advancedOptions,
  // so a successful write has to be followed by a re-list — Core
  // recomputed them all.
  saveDefaults: async (defaults) => {
    set({ saving: true });
    try {
      const stored = await setManagedModelDefaults(defaults);
      const models = await listManagedModels();
      set({ defaults: stored, models, saving: false });
      void refreshManagedRuntimeDiagnostics();
    } catch (e) {
      set({ saving: false });
      throw e;
    }
  },

  reorderModels: async (modelIds) => {
    set({ saving: true });
    try {
      await reorderManagedModels({ modelIds });
      const models = await listManagedModels();
      set({ models, saving: false });
      void refreshManagedRuntimeDiagnostics();
    } catch (e) {
      set({ saving: false });
      throw e;
    }
  },

  deleteModel: async (id) => {
    set({ saving: true });
    try {
      await deleteManagedModel(id);
      const models = await listManagedModels();
      set({ models, saving: false });
      void refreshManagedRuntimeDiagnostics();
    } catch (e) {
      set({ saving: false });
      throw e;
    }
  },
}));

async function refreshManagedRuntimeDiagnostics(): Promise<void> {
  try {
    const managedRuntime = await invoke<ManagedRuntimeDiagnostics>(
      "ensure_managed_runtime_layout",
    );
    applyManagedRuntimeDiagnostics(managedRuntime);
  } catch (e) {
    console.warn("[managed-models] refresh managed runtime diagnostics failed.", e);
  }
}

/** Raw text of a managed-model IPC failure: Core errors arrive as JSON
 * strings carrying `message`, plain strings pass through, `Error`s give
 * their message. Empty when the thrown value carries no text — no
 * fallback copy here (it used to be a hard-coded Chinese 「操作失败」
 * that English UI showed verbatim); callers localize. */
export function managedModelsErrorText(e: unknown): string {
  if (typeof e === "string") {
    try {
      const parsed = JSON.parse(e) as { message?: unknown };
      return typeof parsed.message === "string" ? parsed.message : e;
    } catch {
      return e;
    }
  }
  if (e instanceof Error) return e.message;
  return "";
}
