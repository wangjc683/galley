import { beforeEach, describe, expect, it } from "vitest";

import {
  managedModelsErrorText,
  useManagedModelsStore,
} from "@/stores/managed-models";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type {
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

const provider = {
  id: "prov-1",
  protocol: "openai",
  authKind: "api_key",
  apiBase: "https://api.example.com/v1",
  displayName: "Example",
  credentialStatus: "present",
} as unknown as ManagedModelProviderRecord;

const model = {
  id: "model-1",
  providerId: "prov-1",
  model: "example-1",
  displayName: "",
} as unknown as ManagedModelRecord;

/** Route the mocked Tauri `invoke` per command; a function value can
 * throw to simulate a failing command. */
function routeInvoke(routes: Record<string, unknown>) {
  getTauriMocks().invoke.mockImplementation(async (command) => {
    if (!(command in routes)) return undefined;
    const route = routes[command];
    return typeof route === "function" ? (route as () => unknown)() : route;
  });
}

const loadedRoutes = {
  list_managed_model_providers: [provider],
  list_managed_models: [model],
  get_managed_model_defaults: { reasoning_effort: "high" },
};

beforeEach(() => {
  resetStores();
});

describe("managedModelsErrorText", () => {
  it("unwraps Core's JSON error string, passes plain text through", () => {
    expect(
      managedModelsErrorText(JSON.stringify({ code: "x", message: "boom" })),
    ).toBe("boom");
    expect(managedModelsErrorText("plain failure")).toBe("plain failure");
    expect(managedModelsErrorText(new Error("from js"))).toBe("from js");
  });

  it("invents no copy for a value without text (the UI localizes)", () => {
    expect(managedModelsErrorText({ unexpected: true })).toBe("");
    expect(managedModelsErrorText(undefined)).toBe("");
  });
});

describe("load", () => {
  it("records a failure as loadError and keeps what was already loaded", async () => {
    routeInvoke(loadedRoutes);
    await useManagedModelsStore.getState().load();
    expect(useManagedModelsStore.getState().loadError).toBeNull();

    routeInvoke({
      ...loadedRoutes,
      list_managed_models: () => {
        throw JSON.stringify({ message: "database is locked" });
      },
    });
    const result = await useManagedModelsStore.getState().load();

    expect(result.loadError).toBe("database is locked");
    // The return value says nothing about what is configured…
    expect(result.providers).toEqual([]);
    // …while the store keeps the previous lists on screen.
    const state = useManagedModelsStore.getState();
    expect(state.loadError).toBe("database is locked");
    expect(state.loading).toBe(false);
    expect(state.providers).toEqual([provider]);
    expect(state.models).toEqual([model]);
  });

  it("clears loadError when a later load succeeds", async () => {
    routeInvoke({
      list_managed_model_providers: () => {
        throw "offline";
      },
    });
    await useManagedModelsStore.getState().load();
    expect(useManagedModelsStore.getState().loadError).toBe("offline");

    routeInvoke(loadedRoutes);
    const result = await useManagedModelsStore.getState().load();
    expect(result.loadError).toBeNull();
    expect(useManagedModelsStore.getState().loadError).toBeNull();
  });

  it("a failure without text still reads as a failure to callers", async () => {
    routeInvoke({
      list_managed_model_providers: () => {
        throw { unexpected: true };
      },
    });
    const result = await useManagedModelsStore.getState().load();
    // hydrate branches on truthiness: an empty string would route a
    // configured user to onboarding.
    expect(result.loadError).toBeTruthy();
    // The stored text stays raw (empty): the UI supplies the words.
    expect(useManagedModelsStore.getState().loadError).toBe("");
  });
});

describe("write actions", () => {
  it("rethrow the original error without storing it, and release saving", async () => {
    routeInvoke(loadedRoutes);
    await useManagedModelsStore.getState().load();
    const failure = JSON.stringify({ message: "reorder rejected" });
    routeInvoke({
      ...loadedRoutes,
      reorder_managed_models: () => {
        throw failure;
      },
    });

    await expect(
      useManagedModelsStore.getState().reorderModels(["model-1"]),
    ).rejects.toBe(failure);

    const state = useManagedModelsStore.getState();
    expect(state.saving).toBe(false);
    // A write failure is the caller's to report; it doesn't masquerade
    // as a load failure.
    expect(state.loadError).toBeNull();
    expect(state).not.toHaveProperty("error");
  });
});
