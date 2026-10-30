import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  sessionFromBrief,
  type SessionBriefWire,
} from "@/stores/sessions/shared";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";

import { findMainChat, openMainChat } from "./main-chat";

/**
 * The main chat (ticket 02): Core creates it (`get_or_create_main_chat`)
 * and the page lands on it in managed mode.
 */

const tauriMocks = getTauriMocks();
const NOW = "2026-10-12T08:00:00.000Z";

const MAIN_BRIEF: SessionBriefWire = {
  id: "s-main",
  title: "主聊天",
  status: "idle",
  turnCount: 0,
  lastActivityAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  runtimeKind: "managed",
  runtimeLabel: "内置内核",
  gaRuntimeKind: "managed",
  promptProfile: "galley-persona-v1",
  mainChat: true,
};

function calls(command: string): number {
  return tauriMocks.invoke.mock.calls.filter(([c]) => c === command).length;
}

/** The main chat's messages as the page holds them. */
function mainMessages() {
  return useMessagesStore.getState().byId["s-main"];
}

beforeEach(() => {
  resetStores();
  usePrefsStore.setState({ activeRuntimeKind: "managed" });
  tauriMocks.invoke.mockImplementation(async (command) => {
    if (command === "get_or_create_main_chat") return MAIN_BRIEF;
    if (command === "session_message_turns_page") {
      return { rows: [], hasMore: false, previousUserCreatedAt: null };
    }
    return undefined;
  });
});

describe("the wire", () => {
  it("marks only the main chat", () => {
    expect(sessionFromBrief(MAIN_BRIEF).mainChat).toBe(true);
    const side = sessionFromBrief({
      ...MAIN_BRIEF,
      id: "s-side",
      mainChat: undefined,
    });
    expect("mainChat" in side).toBe(false);
  });

  it("finds it among the sessions", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b", mainChat: true }),
    ];
    expect(findMainChat(sessions)?.id).toBe("b");
    expect(findMainChat([makeSession({ id: "a" })])).toBeUndefined();
  });
});

describe("openMainChat", () => {
  it("lands on the main chat Core hands back, without starting a runner", async () => {
    await expect(openMainChat()).resolves.toBe(true);

    expect(calls("get_or_create_main_chat")).toBe(1);
    const sessions = useSessionsStore.getState();
    expect(sessions.sessions.map((s) => s.id)).toEqual(["s-main"]);
    expect(sessions.sessions[0].mainChat).toBe(true);
    expect(sessions.activeSessionId).toBe("s-main");
    expect(useUiStore.getState().screen).toBe("main");
    // The first send starts it, as the empty composer's first message does.
    expect(calls("ensure_session_runner")).toBe(0);
  });

  it("names the UI language, which picks a new main chat's greeting", async () => {
    usePrefsStore.setState({ languagePreference: "en-US" });
    await openMainChat();
    usePrefsStore.setState({ languagePreference: "zh-CN" });
    await openMainChat();

    const args = tauriMocks.invoke.mock.calls
      .filter(([c]) => c === "get_or_create_main_chat")
      .map(([, a]) => a);
    expect(args).toEqual([{ language: "en-US" }, { language: "zh-CN" }]);
  });

  it("asks again but changes nothing while the main chat is on screen", async () => {
    await openMainChat();
    await vi.waitFor(() => expect(mainMessages()?.historyRead).toBe(true));
    const before = useSessionsStore.getState().sessions;

    await expect(openMainChat()).resolves.toBe(true);

    expect(useSessionsStore.getState().sessions).toBe(before);
    expect(useSessionsStore.getState().activeSessionId).toBe("s-main");
    expect(calls("session_message_turns_page")).toBe(1);
  });

  it("lands again while on screen when its history read failed, and reads it (ticket 113)", async () => {
    let failNext = true;
    tauriMocks.invoke.mockImplementation(async (command) => {
      if (command === "get_or_create_main_chat") return MAIN_BRIEF;
      if (command === "session_message_turns_page") {
        if (failNext) {
          failNext = false;
          throw new Error("database is locked");
        }
        return { rows: [], hasMore: false, previousUserCreatedAt: null };
      }
      return undefined;
    });
    await openMainChat();
    await vi.waitFor(() => {
      expect(calls("session_message_turns_page")).toBe(1);
      expect(mainMessages()?.restoring).toBe(false);
    });
    expect(mainMessages()?.historyRead).toBe(false);

    await expect(openMainChat()).resolves.toBe(true);

    await vi.waitFor(() => expect(mainMessages()?.historyRead).toBe(true));
    expect(calls("session_message_turns_page")).toBe(2);
    expect(useSessionsStore.getState().activeSessionId).toBe("s-main");
  });

  it("shares one landing between concurrent calls", async () => {
    const [a, b] = await Promise.all([openMainChat(), openMainChat()]);
    expect([a, b]).toEqual([true, true]);
    expect(calls("get_or_create_main_chat")).toBe(1);
  });

  it("does nothing on the external runtime, which has no main chat", async () => {
    usePrefsStore.setState({ activeRuntimeKind: "external" });

    await expect(openMainChat()).resolves.toBe(false);

    expect(calls("get_or_create_main_chat")).toBe(0);
    expect(useUiStore.getState().screen).toBe("empty");
    expect(useSessionsStore.getState().activeSessionId).toBeUndefined();
  });

  it("leaves the empty composer up when Core fails", async () => {
    tauriMocks.invoke.mockImplementation(async (command) => {
      if (command === "get_or_create_main_chat") throw new Error("db down");
      return undefined;
    });

    await expect(openMainChat()).resolves.toBe(false);

    expect(useUiStore.getState().screen).toBe("empty");
    expect(useSessionsStore.getState().sessions).toEqual([]);
  });
});
