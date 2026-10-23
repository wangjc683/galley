import { beforeEach, describe, expect, it } from "vitest";

import { readComposerDraft, saveComposerDraft } from "@/lib/composer-draft";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useSessionsStore } from "@/stores/sessions";
import type { SessionBriefWire } from "@/stores/sessions/shared";
import { useSubtasksStore } from "@/stores/subtasks";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";

import {
  resetFailure,
  resetMainChat,
  resetSessionIds,
} from "./main-chat-reset";

/**
 * Resetting the main chat from the page (main chat ticket 15): Core
 * resets; the page forgets the old main chat and its unpromoted
 * subtasks wherever it keeps them, closes Settings and lands on the new
 * main chat. A refusal leaves the page as it was.
 */

const tauriMocks = getTauriMocks();
const NOW = "2026-10-14T08:00:00.000Z";

const NEW_MAIN: SessionBriefWire = {
  id: "s-new-main",
  title: "主聊天",
  status: "idle",
  turnCount: 0,
  lastActivityAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  runtimeKind: "managed",
  runtimeLabel: "内置内核",
  gaRuntimeKind: "managed",
  mainChat: true,
};

const managed = { runtimeKind: "managed", gaRuntimeKind: "managed" } as const;
const OLD_MAIN = makeSession({ id: "s-old-main", mainChat: true, ...managed });
const SUBTASK = makeSession({
  id: "s-sub",
  parentSessionId: "s-old-main",
  ...managed,
});
const ARCHIVED_SUBTASK = makeSession({
  id: "s-sub-archived",
  parentSessionId: "s-old-main",
  status: "archived",
  ...managed,
});
const PROMOTED = makeSession({
  id: "s-promoted",
  parentSessionId: "s-old-main",
  promoted: true,
  ...managed,
});
const OTHER = makeSession({ id: "s-other", ...managed });
const ALL = [OLD_MAIN, SUBTASK, ARCHIVED_SUBTASK, PROMOTED, OTHER];

function calls(command: string): Array<Record<string, unknown> | undefined> {
  return tauriMocks.invoke.mock.calls
    .filter(([c]) => c === command)
    .map(([, args]) => args);
}

beforeEach(() => {
  resetStores();
  useSubtasksStore.setState({ byParent: {}, requested: {}, runErrors: {} });
  usePrefsStore.setState({
    activeRuntimeKind: "managed",
    languagePreference: "zh-CN",
  });
  useSessionsStore.setState({ sessions: ALL, activeSessionId: OLD_MAIN.id });
  useUiStore.setState({ screen: "main", settingsOpen: true });
  // Each session has a conversation in memory.
  for (const s of ALL) useMessagesStore.getState().ensureMessages(s.id);
  useSubtasksStore.setState({
    byParent: { [OLD_MAIN.id]: [] },
    requested: { [OLD_MAIN.id]: true },
    runErrors: { [SUBTASK.id]: "boom", [OTHER.id]: "kept" },
  });
  saveComposerDraft(OLD_MAIN.id, { text: "没发出去的话", images: [] });
  tauriMocks.invoke.mockImplementation(async (command) => {
    if (command === "reset_main_chat") return NEW_MAIN;
    if (command === "get_or_create_main_chat") return NEW_MAIN;
    return undefined;
  });
});

describe("resetSessionIds", () => {
  it("is the main chat and its unpromoted subtasks, archived ones too", () => {
    expect(resetSessionIds(ALL)).toEqual([
      OLD_MAIN.id,
      SUBTASK.id,
      ARCHIVED_SUBTASK.id,
    ]);
    expect(resetSessionIds([OTHER])).toEqual([]);
  });
});

describe("resetFailure", () => {
  it("tells a running refusal from everything else, keeping Core's words", () => {
    const running = '{"error":"running","detail":"session s-x is running"}';
    expect(resetFailure(running)).toEqual({ kind: "running", detail: running });
    const failed = '{"error":"failed","detail":"disk full"}';
    expect(resetFailure(failed)).toEqual({ kind: "other", detail: failed });
    expect(resetFailure('{"error":"not_managed","detail":"x"}').kind).toBe(
      "other",
    );
    expect(resetFailure(new Error("ipc down"))).toEqual({
      kind: "other",
      detail: "ipc down",
    });
    expect(resetFailure("null").kind).toBe("other");
  });
});

describe("resetMainChat", () => {
  it("asks Core in the UI language, then lands on the new main chat", async () => {
    await resetMainChat();

    expect(calls("reset_main_chat")).toEqual([{ language: "zh-CN" }]);
    const sessions = useSessionsStore.getState();
    expect(sessions.sessions.map((s) => s.id).sort()).toEqual(
      [NEW_MAIN.id, OTHER.id, PROMOTED.id].sort(),
    );
    expect(sessions.activeSessionId).toBe(NEW_MAIN.id);
    expect(useUiStore.getState().screen).toBe("main");
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("forgets the old sessions everywhere the page keeps them", async () => {
    await resetMainChat();

    const byId = useMessagesStore.getState().byId;
    for (const id of [OLD_MAIN.id, SUBTASK.id, ARCHIVED_SUBTASK.id]) {
      expect(byId[id], id).toBeUndefined();
    }
    expect(byId[OTHER.id]).toBeDefined();
    expect(byId[PROMOTED.id]).toBeDefined();
    const subtasks = useSubtasksStore.getState();
    expect(subtasks.byParent).toEqual({});
    expect(subtasks.requested).toEqual({});
    expect(subtasks.runErrors).toEqual({ [OTHER.id]: "kept" });
    expect(readComposerDraft(OLD_MAIN.id)).toBeUndefined();
  });

  it("a refusal leaves the page as it was", async () => {
    tauriMocks.invoke.mockImplementation(async (command) => {
      if (command === "reset_main_chat") {
        throw '{"error":"running","detail":"session s-other is running"}';
      }
      return undefined;
    });

    await expect(resetMainChat()).rejects.toBe(
      '{"error":"running","detail":"session s-other is running"}',
    );

    const sessions = useSessionsStore.getState();
    expect(sessions.sessions).toEqual(ALL);
    expect(sessions.activeSessionId).toBe(OLD_MAIN.id);
    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(useSubtasksStore.getState().runErrors[SUBTASK.id]).toBe("boom");
    expect(readComposerDraft(OLD_MAIN.id)?.text).toBe("没发出去的话");
    expect(calls("get_or_create_main_chat")).toEqual([]);
  });
});
