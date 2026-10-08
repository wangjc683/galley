import { describe, expect, it } from "vitest";

import type { ModelDraftState } from "./types";
import { fallbackModelDraftAfterFetch } from "./use-provider-model-controller";

function draft(patch: Partial<ModelDraftState> = {}): ModelDraftState {
  return {
    providerId: "prov-a",
    model: "",
    displayName: "",
    presetOptions: {},
    advancedOverrides: {},
    ...patch,
  };
}

describe("fallbackModelDraftAfterFetch", () => {
  it("opens a manual-add draft when nothing is being edited", () => {
    for (const outcome of ["empty", "failed"] as const) {
      expect(
        fallbackModelDraftAfterFetch({
          current: null,
          currentDirty: false,
          providerId: "prov-a",
          outcome,
        }),
      ).toBe("open-new");
    }
  });

  it("never replaces a draft holding unsaved input — on any provider", () => {
    for (const outcome of ["empty", "failed"] as const) {
      for (const providerId of ["prov-a", "prov-b"]) {
        expect(
          fallbackModelDraftAfterFetch({
            current: draft({ id: "model-1", model: "edited" }),
            currentDirty: true,
            providerId,
            outcome,
          }),
        ).toBe("keep");
      }
    }
  });

  it("a clean draft elsewhere gives way to the fallback", () => {
    expect(
      fallbackModelDraftAfterFetch({
        current: draft({ providerId: "prov-b", id: "model-9" }),
        currentDirty: false,
        providerId: "prov-a",
        outcome: "empty",
      }),
    ).toBe("open-new");
    expect(
      fallbackModelDraftAfterFetch({
        current: draft({ providerId: "prov-b" }),
        currentDirty: false,
        providerId: "prov-a",
        outcome: "failed",
      }),
    ).toBe("open-new");
  });

  it("a failed read keeps a draft already open on the same provider", () => {
    expect(
      fallbackModelDraftAfterFetch({
        current: draft({ providerId: "prov-a" }),
        currentDirty: false,
        providerId: "prov-a",
        outcome: "failed",
      }),
    ).toBe("keep");
  });
});
