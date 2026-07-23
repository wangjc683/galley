import { describe, expect, it } from "vitest";

import { useSessionsStore } from "@/stores/sessions";

/**
 * Guard for the slice merge in sessions.ts: if a slice is dropped from
 * the `create()` spread (or an action is moved out without a new home),
 * the merged store silently loses keys — App.tsx selectors would then
 * return undefined at runtime while still typechecking against the
 * composed SessionsStore type. Assert the full public shape instead.
 */
describe("useSessionsStore shape", () => {
  it("exposes all state fields and actions after the slice merge", () => {
    const keys = new Set(Object.keys(useSessionsStore.getState()));
    const expected = [
      // state
      "sessions",
      "activeSessionId",
      "projects",
      "activeProjectFilter",
      // lifecycle
      "setActiveSession",
      "activateSession",
      "createSession",
      "createSessionPersisted",
      "renameSession",
      "togglePinSession",
      "setSessionApprovalMode",
      "bumpSessionAfterTurn",
      "setSessionLlm",
      "maybeDeriveTitle",
      "setLastStepIndex",
      "applyExternalSessionCreated",
      "applyExternalSessionUpdated",
      // archive / delete
      "archiveSession",
      "unarchiveSession",
      "deleteSessionPermanently",
      "archiveSessionsBulk",
      "unarchiveSessionsBulk",
      "deleteSessionsPermanentlyBulk",
      "emptyArchive",
      // projects
      "createProject",
      "updateProject",
      "deleteProject",
      "assignSessionToProject",
      "setActiveProjectFilter",
      "applyExternalProjectCreated",
      "applyExternalProjectDeleted",
      // hydrate
      "hydrate",
    ];
    for (const key of expected) {
      expect(keys, `missing store key: ${key}`).toContain(key);
    }
  });
});
