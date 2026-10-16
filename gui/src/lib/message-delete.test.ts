import { beforeEach, describe, expect, it } from "vitest";

import { assistantLinePlan } from "@/lib/assistant-conversation";
import {
  deletableMessage,
  deleteFailure,
  deleteMainChatMessage,
  messageDeleteBlock,
  type DeletableMessage,
} from "@/lib/message-delete";
import { buildRunGroups, liveRunGroup } from "@/lib/run-groups";
import { SUBTASK_REPORT_SUPERVISOR } from "@/lib/subtasks";
import { useMessagesStore } from "@/stores/messages";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";

/**
 * Deleting one message of the main chat from the page (ticket 32): which
 * bubble a right-click names, when 删除 is greyed and why, Core's
 * refusals, and the turns the page drops.
 */

const tauriMocks = getTauriMocks();
const SID = "s-main";

function tool(name: string): ConversationToolEvent {
  return {
    id: `t-${name}-${Math.random()}`,
    name,
    status: "success-historical",
    args: {},
  };
}
function user(id: string): UserTurn {
  return { role: "user", content: id, messageId: id };
}
function step(id: string): AgentTurn {
  return {
    role: "agent",
    tools: [tool("web_scan")],
    finalAnswer: null,
    messageId: id,
  };
}
function question(id: string): AgentTurn {
  return {
    role: "agent",
    tools: [{ ...tool("ask_user"), args: { question: "哪天？" } }],
    finalAnswer: null,
    messageId: id,
  };
}
function answer(id: string): AgentTurn {
  return {
    role: "agent",
    tools: [tool("no_tool")],
    finalAnswer: `${id} 的回答`,
    messageId: id,
  };
}
function greeting(): AgentTurn {
  return { ...answer("g"), tools: [], greeting: true };
}

/** What the assistant's conversation reads a right-click with. */
function resolve(turns: Turn[], messageId: string, running = false) {
  const groups = buildRunGroups(turns, { splitAfterAnswer: true });
  const plan = assistantLinePlan(
    groups,
    turns,
    liveRunGroup(groups, running, false),
  );
  return deletableMessage(turns, plan, groups, messageId);
}

describe("deletableMessage", () => {
  const turns: Turn[] = [
    greeting(),
    user("u0"),
    step("s0"),
    question("q1"),
    user("ans"),
    step("s2"),
    answer("a3"),
    user("u4"),
    answer("a4"),
  ];

  it("your message, the greeting: themselves", () => {
    expect(resolve(turns, "u0")).toEqual({
      messageId: "u0",
      replyAnswerId: null,
    });
    expect(resolve(turns, "ans")).toEqual({
      messageId: "ans",
      replyAnswerId: null,
    });
    expect(resolve(turns, "g")).toEqual({
      messageId: "g",
      replyAnswerId: null,
    });
  });

  it("a reply's answer or its question names the reply, by its answer", () => {
    expect(resolve(turns, "a3")).toEqual({
      messageId: "a3",
      replyAnswerId: "a3",
    });
    expect(resolve(turns, "q1")).toEqual({
      messageId: "q1",
      replyAnswerId: "a3",
    });
    expect(resolve(turns, "a4")).toEqual({
      messageId: "a4",
      replyAnswerId: "a4",
    });
  });

  it("a step, a report row or an unknown row names nothing", () => {
    expect(resolve(turns, "s0")).toBeNull();
    expect(resolve(turns, "nope")).toBeNull();
    const report: UserTurn = {
      ...user("r"),
      origin: { via: "system", supervisor: SUBTASK_REPORT_SUPERVISOR },
    };
    expect(
      resolve([user("u0"), answer("a0"), report, answer("a1")], "r"),
    ).toBeNull();
  });

  it("a run drawn the workbench way (no answer, not live) names nothing", () => {
    const aborted: Turn[] = [user("u0"), answer("a0"), user("u1"), step("s1")];
    expect(resolve(aborted, "s1")).toBeNull();
  });

  it("replies left side by side by a deleted message stay apart", () => {
    const split: Turn[] = [user("u0"), answer("a0"), step("s1"), answer("a2")];
    expect(resolve(split, "a0")).toEqual({
      messageId: "a0",
      replyAnswerId: "a0",
    });
    expect(resolve(split, "a2")).toEqual({
      messageId: "a2",
      replyAnswerId: "a2",
    });
  });
});

describe("messageDeleteBlock", () => {
  const reply: DeletableMessage = { messageId: "q1", replyAnswerId: "a3" };
  const yours: DeletableMessage = { messageId: "u0", replyAnswerId: null };
  const state = (
    over: Partial<Parameters<typeof messageDeleteBlock>[1]> = {},
  ) => ({
    running: false,
    asking: false,
    hasSubtasks: (id: string) => id === "a3",
    ...over,
  });

  it("greys every bubble while it replies or waits for an answer", () => {
    expect(messageDeleteBlock(yours, state({ running: true }))).toBe("running");
    expect(messageDeleteBlock(yours, state({ asking: true }))).toBe("asking");
  });

  it("greys a reply with subtask cards, and only that reply", () => {
    expect(messageDeleteBlock(reply, state())).toBe("subtasks");
    expect(messageDeleteBlock(yours, state())).toBeNull();
    expect(
      messageDeleteBlock({ messageId: "a4", replyAnswerId: "a4" }, state()),
    ).toBeNull();
  });
});

describe("deleteFailure", () => {
  it("names Core's refusals and keeps its words", () => {
    const busy = '{"error":"busy","detail":"the main chat is running"}';
    expect(deleteFailure(busy)).toEqual({ kind: "busy", detail: busy });
    const subtasks = '{"error":"has_subtasks","detail":"x"}';
    expect(deleteFailure(subtasks).kind).toBe("subtasks");
    expect(deleteFailure('{"error":"failed","detail":"disk"}').kind).toBe(
      "other",
    );
    expect(deleteFailure(new Error("ipc down"))).toEqual({
      kind: "other",
      detail: "ipc down",
    });
  });
});

describe("deleteMainChatMessage", () => {
  beforeEach(() => {
    resetStores();
    const store = useMessagesStore.getState();
    store.ensureMessages(SID);
    useMessagesStore.setState((s) => ({
      byId: {
        ...s.byId,
        [SID]: {
          ...s.byId[SID],
          turns: [
            greeting(),
            user("u0"),
            step("s0"),
            answer("a1"),
            user("u2"),
            answer("a2"),
          ],
          nextSuggestion: "再查一下",
        },
      },
    }));
  });

  it("asks Core, then drops exactly the rows it names", async () => {
    tauriMocks.invoke.mockImplementation(async (command) =>
      command === "delete_main_chat_message"
        ? { sessionId: SID, messageIds: ["s0", "a1"], via: "gui" }
        : undefined,
    );
    await deleteMainChatMessage(SID, "a1");

    expect(tauriMocks.invoke).toHaveBeenCalledWith("delete_main_chat_message", {
      sessionId: SID,
      messageId: "a1",
    });
    const slice = useMessagesStore.getState().byId[SID];
    expect(
      slice.turns.map((t) => (t.role === "system" ? "" : t.messageId)),
    ).toEqual(["g", "u0", "u2", "a2"]);
    // An earlier reply: the latest one's ghost suggestion stays.
    expect(slice.nextSuggestion).toBe("再查一下");
  });

  it("changes nothing when Core refuses", async () => {
    tauriMocks.invoke.mockRejectedValue('{"error":"busy","detail":"running"}');
    await expect(deleteMainChatMessage(SID, "a1")).rejects.toBe(
      '{"error":"busy","detail":"running"}',
    );
    expect(useMessagesStore.getState().byId[SID].turns).toHaveLength(6);
  });
});
