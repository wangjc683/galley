import { beforeEach, describe, expect, it } from "vitest";

import { copyForLanguage } from "@/lib/i18n";
import { usePrefsStore } from "@/stores/prefs";
import { resetStores } from "@/test/store-reset";

import { formatInvokeError, shouldUseBundledPython } from "./bridge";

describe("shouldUseBundledPython", () => {
  it("never uses the bundle in dev builds", () => {
    expect(
      shouldUseBundledPython({ isProd: false, runtimeKind: "managed" }),
    ).toBe(false);
    expect(
      shouldUseBundledPython({
        isProd: false,
        runtimeKind: "external",
        useExternalPython: false,
      }),
    ).toBe(false);
  });

  it("pins bundled-engine sessions to the bundle even with external Python on", () => {
    expect(
      shouldUseBundledPython({
        isProd: true,
        runtimeKind: "managed",
        useExternalPython: true,
      }),
    ).toBe(true);
    expect(
      shouldUseBundledPython({
        isProd: true,
        runtimeKind: "managed",
        useExternalPython: false,
      }),
    ).toBe(true);
  });

  it("lets external sessions opt out of the bundle", () => {
    expect(
      shouldUseBundledPython({
        isProd: true,
        runtimeKind: "external",
        useExternalPython: true,
      }),
    ).toBe(false);
    expect(
      shouldUseBundledPython({
        isProd: true,
        runtimeKind: "external",
        useExternalPython: false,
      }),
    ).toBe(true);
  });

  it("treats an omitted runtime kind as the legacy external default", () => {
    expect(
      shouldUseBundledPython({ isProd: true, useExternalPython: true }),
    ).toBe(false);
    expect(shouldUseBundledPython({ isProd: true })).toBe(true);
  });
});

describe("formatInvokeError · the runner-start errors that say what to do", () => {
  beforeEach(() => {
    resetStores();
  });

  const tagged = (error: string) =>
    JSON.stringify({ error, detail: "from Core" });

  it("words them in the UI's language, from the locale", () => {
    for (const language of ["zh-CN", "en-US"] as const) {
      usePrefsStore.setState({ languagePreference: language });
      const errors = copyForLanguage(language).errors;
      expect(formatInvokeError(tagged("managed_model_not_configured"))).toBe(
        errors.managedModelUnavailable,
      );
      expect(formatInvokeError(tagged("managed_runtime_invalid"))).toBe(
        errors.managedRuntimeInvalid,
      );
      expect(formatInvokeError(tagged("ga_path_invalid"))).toBe(
        errors.gaPathInvalid,
      );
    }
  });

  it("keeps the tag and detail for every other error", () => {
    usePrefsStore.setState({ languagePreference: "en-US" });
    expect(formatInvokeError(tagged("python_not_found"))).toBe(
      "Python not found: from Core",
    );
    expect(formatInvokeError("plain failure")).toBe("plain failure");
  });
});
