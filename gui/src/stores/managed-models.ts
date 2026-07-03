import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

import { applyManagedRuntimeDiagnostics } from "@/lib/managed-runtime-diagnostics";
import {
  deleteManagedModelProvider,
  deleteManagedModel,
  listManagedModelProviders,
  listManagedModels,
  saveManagedModelProvider,
  saveManagedModel,
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
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface ManagedModelsActions {
  load: () => Promise<{
    providers: ManagedModelProviderRecord[];
    models: ManagedModelRecord[];
    /** Set when the load itself failed — the (empty) lists then say
     * NOTHING about what is configured. Callers deciding "does the
     * user have models?" must branch on this, not on length. */
    loadError: string | null;
  }>;
  saveProvider: (input: SaveManagedProviderInput) => Promise<ManagedModelProviderRecord>;
  deleteProvider: (id: string) => Promise<void>;
  saveModel: (input: SaveManagedModelInput) => Promise<void>;
  reorderModels: (modelIds: string[]) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  clearError: () => void;
}

export type ManagedModelsStore = ManagedModelsState & ManagedModelsActions;

export const useManagedModelsStore = create<ManagedModelsStore>((set) => ({
  providers: [],
  models: [],
  loading: false,
  saving: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [providers, models] = await Promise.all([
        listManagedModelProviders(),
        listManagedModels(),
      ]);
      set({ providers, models, loading: false });
      return { providers, models, loadError: null };
    } catch (e) {
      const loadError = errorMessage(e);
      set({ loading: false, error: loadError });
      return { providers: [], models: [], loadError };
    }
  },

  saveProvider: async (input) => {
    set({ saving: true, error: null });
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
      set({ saving: false, error: errorMessage(e) });
      throw e;
    }
  },

  deleteProvider: async (id) => {
    set({ saving: true, error: null });
    try {
      await deleteManagedModelProvider(id);
      const [providers, models] = await Promise.all([
        listManagedModelProviders(),
        listManagedModels(),
      ]);
      set({ providers, models, saving: false });
      void refreshManagedRuntimeDiagnostics();
    } catch (e) {
      set({ saving: false, error: errorMessage(e) });
      throw e;
    }
  },

  saveModel: async (input) => {
    set({ saving: true, error: null });
    try {
      await saveManagedModel(input);
      const models = await listManagedModels();
      set({ models, saving: false });
      void refreshManagedRuntimeDiagnostics();
    } catch (e) {
      set({ saving: false, error: errorMessage(e) });
      throw e;
    }
  },

  reorderModels: async (modelIds) => {
    set({ saving: true, error: null });
    try {
      await reorderManagedModels({ modelIds });
      const models = await listManagedModels();
      set({ models, saving: false });
      void refreshManagedRuntimeDiagnostics();
    } catch (e) {
      set({ saving: false, error: errorMessage(e) });
      throw e;
    }
  },

  deleteModel: async (id) => {
    set({ saving: true, error: null });
    try {
      await deleteManagedModel(id);
      const models = await listManagedModels();
      set({ models, saving: false });
      void refreshManagedRuntimeDiagnostics();
    } catch (e) {
      set({ saving: false, error: errorMessage(e) });
      throw e;
    }
  },

  clearError: () => set({ error: null }),
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

function errorMessage(e: unknown): string {
  if (typeof e === "string") {
    try {
      const parsed = JSON.parse(e) as { message?: string };
      return parsed.message ?? e;
    } catch {
      return e;
    }
  }
  if (e instanceof Error) return e.message;
  return "操作失败";
}
