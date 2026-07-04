import { describe, expect, it } from "vitest";

import {
  addCustomPrompt,
  createCopiedPromptTitle,
  deleteCustomPrompt,
  defaultSavedPromptsPrefs,
  moveCustomPrompt,
  normalizeSavedPromptsPrefs,
  resolveSavedPrompts,
  updateCustomPrompt,
} from "@/lib/saved-prompts";

describe("saved prompt helpers", () => {
  it("carries preset descriptions through resolve, leaves custom without one", () => {
    const resolved = resolveSavedPrompts(
      [{ id: "preset:p", title: "P", description: "does a thing", body: "B" }],
      {
        schemaVersion: 2,
        customPrompts: [
          {
            id: "custom:c",
            title: "C",
            body: "CB",
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          },
        ],
      },
    );
    const preset = resolved.find((p) => p.kind === "preset");
    const custom = resolved.find((p) => p.kind === "custom");
    expect(preset?.description).toBe("does a thing");
    // Custom prompts never carry a description — the card falls back to a
    // body preview for them.
    expect(custom?.description).toBeUndefined();
  });

  it("resets legacy or corrupt prefs to the v2 default", () => {
    // Legacy v1 prefs (with pinnedIds) and any unknown schema fall back to a
    // clean v2 default — no migration, since the pinned feature was removed
    // before the first public release.
    const legacy = {
      schemaVersion: 1,
      customPrompts: [{ id: "custom:x", title: "X", body: "b" }],
      pinnedIds: ["preset:web-research"],
    };
    expect(normalizeSavedPromptsPrefs(legacy)).toEqual(
      defaultSavedPromptsPrefs(),
    );
    expect(normalizeSavedPromptsPrefs(undefined)).toEqual(
      defaultSavedPromptsPrefs(),
    );
    expect(normalizeSavedPromptsPrefs({ schemaVersion: 99 })).toEqual(
      defaultSavedPromptsPrefs(),
    );
  });

  it("keeps valid v2 custom prompts", () => {
    const raw = {
      schemaVersion: 2,
      customPrompts: [{ id: "custom:a", title: "A", body: "Body" }],
    };
    expect(normalizeSavedPromptsPrefs(raw).customPrompts.map((p) => p.id)).toEqual(
      ["custom:a"],
    );
  });

  it("dedupes custom prompts sharing an id, keeping the first", () => {
    const raw = {
      schemaVersion: 2,
      customPrompts: [
        { id: "custom:dup", title: "First", body: "Body" },
        { id: "custom:dup", title: "Second", body: "Body" },
        { id: "custom:other", title: "Other", body: "Body" },
      ],
    };
    const normalized = normalizeSavedPromptsPrefs(raw);
    expect(normalized.customPrompts.map((p) => p.id)).toEqual([
      "custom:dup",
      "custom:other",
    ]);
    expect(normalized.customPrompts[0].title).toBe("First");
  });

  it("trims custom prompt input and rejects empty title or body", () => {
    const prefs = defaultSavedPromptsPrefs();
    const now = "2026-01-01T00:00:00.000Z";

    const added = addCustomPrompt(
      prefs,
      { title: "  Review  ", body: "  Check this file.  " },
      "custom:review",
      now,
    );
    expect(added.customPrompts[0]).toMatchObject({
      id: "custom:review",
      title: "Review",
      body: "Check this file.",
    });
    expect(
      addCustomPrompt(prefs, { title: "", body: "Body" }, "custom:nope", now),
    ).toBe(prefs);

    const updated = updateCustomPrompt(
      added,
      "custom:review",
      { title: "  New  ", body: "  New body  " },
      "2026-01-02T00:00:00.000Z",
    );
    expect(updated.customPrompts[0]).toMatchObject({
      title: "New",
      body: "New body",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(
      updateCustomPrompt(
        added,
        "custom:review",
        { title: "No body", body: "" },
        now,
      ),
    ).toBe(added);
  });

  it("adds custom prompts first and moves them in manual order", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const first = addCustomPrompt(
      defaultSavedPromptsPrefs(),
      { title: "First", body: "Body" },
      "custom:first",
      now,
    );
    const second = addCustomPrompt(
      first,
      { title: "Second", body: "Body" },
      "custom:second",
      now,
    );

    expect(second.customPrompts.map((prompt) => prompt.id)).toEqual([
      "custom:second",
      "custom:first",
    ]);

    const movedUp = moveCustomPrompt(second, "custom:first", "up");
    expect(movedUp.customPrompts.map((prompt) => prompt.id)).toEqual([
      "custom:first",
      "custom:second",
    ]);
    expect(moveCustomPrompt(movedUp, "custom:first", "up")).toBe(movedUp);
    expect(moveCustomPrompt(movedUp, "custom:missing", "down")).toBe(movedUp);
  });

  it("removes deleted custom prompts", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const prefs = addCustomPrompt(
      defaultSavedPromptsPrefs(),
      { title: "A", body: "Body" },
      "custom:a",
      now,
    );
    expect(deleteCustomPrompt(prefs, "custom:a").customPrompts).toHaveLength(0);
  });

  it("creates copied prompt titles with a localized suffix", () => {
    expect(createCopiedPromptTitle("  信息查证  ", "（副本）")).toBe(
      "信息查证（副本）",
    );
    expect(createCopiedPromptTitle("Check information", " (copy)")).toBe(
      "Check information (copy)",
    );
  });
});
