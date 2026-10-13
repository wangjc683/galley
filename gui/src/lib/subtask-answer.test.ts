import { beforeEach, describe, expect, it } from "vitest";

import { copyForLanguage } from "@/lib/i18n";
import type { SendUserMessageResult } from "@/lib/session-send";
import { answerSubtask } from "@/lib/subtask-answer";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";

/**
 * A subtask's question is answered from its card in the main chat
 * (main chat ticket 06a): the Composer's own Core send, to the
 * subtask's session — Core sees the pending question and dispatches the
 * text as the answer.
 */

const tauriMocks = getTauriMocks();
const copy = copyForLanguage("zh-CN");
const SUB = "s-sub-answer";

function seed(): void {
  useSessionsStore.setState({
    sessions: [
      makeSession({ id: "s-main", mainChat: true, gaRuntimeKind: "managed" }),
      makeSession({
        id: SUB,
        title: "订机票",
        parentSessionId: "s-main",
        gaRuntimeKind: "managed",
        turnCount: 1,
      }),
    ],
    // The main chat is the one open: the card is in it.
    activeSessionId: "s-main",
  });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
  const messages = useMessagesStore.getState();
  messages.ensureMessages(SUB);
  messages.setPendingAskUser(SUB, {
    question: "靠窗还是靠过道？",
    candidates: ["靠窗", "靠过道"],
  });
}

beforeEach(() => {
  resetStores();
  tauriMocks.listen.mockResolvedValue(() => {});
});

describe("answering a subtask from its card", () => {
  it("sends the text to the subtask through Core's send, echoed as its answer", async () => {
    seed();
    tauriMocks.invoke.mockImplementation(async (command, args) => {
      if (command === "send_user_message") {
        const a = args as { sessionId: string; text: string };
        return {
          outcome: "dispatched",
          message: {
            id: `msg_${a.sessionId}_2_user`,
            sessionId: a.sessionId,
            role: "user",
            content: a.text,
            turnIndex: 2,
            createdAt: "2026-10-13T08:00:00.000Z",
            origin: { via: "gui" },
          },
          queue: null,
          runner: { pid: 41, spawned: false, ready: null },
        } satisfies SendUserMessageResult;
      }
      if (command === "list_live_runners") return [];
      return undefined;
    });

    const outcome = await answerSubtask(SUB, "  靠窗 ", copy);

    expect(outcome).toBe("dispatched");
    const sends = tauriMocks.invoke.mock.calls.filter(
      ([command]) => command === "send_user_message",
    );
    expect(sends).toHaveLength(1);
    expect(sends[0][1]).toMatchObject({ sessionId: SUB, text: "靠窗" });
    const slice = useMessagesStore.getState().byId[SUB];
    // The echo is the subtask's, and it answers the question.
    expect(slice.pendingAskUser).toBeNull();
    expect(slice.turns[slice.turns.length - 1]).toMatchObject({
      role: "user",
      content: "靠窗",
    });
    // The main chat is untouched.
    expect(useMessagesStore.getState().byId["s-main"]?.turns ?? []).toEqual([]);
  });

  it("sends nothing for an empty reply", async () => {
    seed();
    expect(await answerSubtask(SUB, "   ", copy)).toBeNull();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "send_user_message",
      expect.anything(),
    );
  });

  it("says so when Core refuses, and stops the run it showed", async () => {
    seed();
    tauriMocks.invoke.mockImplementation(async (command) => {
      if (command === "send_user_message") throw new Error("runner gone");
      if (command === "list_live_runners") return [];
      return undefined;
    });

    expect(await answerSubtask(SUB, "靠窗", copy)).toBeNull();
    expect(useMessagesStore.getState().byId[SUB].agentRunning).toBe(false);
    // Newest toast first.
    expect(useUiStore.getState().toasts[0]?.title).toBe("发送失败");
  });
});
