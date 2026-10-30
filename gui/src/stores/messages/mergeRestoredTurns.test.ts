import { describe, expect, it } from "vitest";

import type {
  AgentTurn,
  SystemTurn,
  Turn,
  UserTurn,
} from "@/types/conversation";

import { mergeRestoredTurns } from "./mergeRestoredTurns";

/**
 * Ticket 113: the page a restore read, merged with the turns that
 * arrived live first. What the page holds is drawn once (the live
 * object, already on screen), what came after the read or is not
 * persisted stays.
 */

function user(id: string | undefined, content = id ?? "?"): UserTurn {
  return id === undefined
    ? { role: "user", content }
    : { role: "user", content, messageId: `msg_s_${id}_user` };
}

function agent(id: string, answer = id): AgentTurn {
  return {
    role: "agent",
    messageId: `msg_s_${id}_assistant`,
    tools: [],
    finalAnswer: answer,
  };
}

function system(
  content: string,
  variant: SystemTurn["variant"] = "system",
): SystemTurn {
  return { role: "system", content, variant };
}

const page: Turn[] = [user("0"), agent("0"), user("1"), agent("1")];

describe("mergeRestoredTurns", () => {
  it("is the page when nothing arrived live", () => {
    expect(mergeRestoredTurns(page, [])).toBe(page);
  });

  it("draws a live turn the page holds once, as the object on screen", () => {
    const live = [{ ...user("1") }, { ...agent("1") }];
    const merged = mergeRestoredTurns(page, live);
    expect(merged).toEqual(page);
    expect(merged[2]).toBe(live[0]);
    expect(merged[3]).toBe(live[1]);
  });

  it("appends what came after the read, in arrival order", () => {
    const later = [agent("2"), user("3"), agent("3")];
    expect(mergeRestoredTurns(page, [user("1"), agent("1"), ...later])).toEqual(
      [...page, ...later],
    );
    // Nothing live is in the page at all: all of it came after.
    expect(mergeRestoredTurns(page, later)).toEqual([...page, ...later]);
  });

  it("keeps an optimistic send and a /btw exchange that are not persisted", () => {
    const echo: UserTurn = {
      role: "user",
      content: "再来",
      clientRequestId: "c1",
    };
    const btw = [
      user(undefined, "/btw 几点了"),
      system("十点", "side_question"),
    ];
    expect(
      mergeRestoredTurns(page, [user("1"), ...btw, agent("1"), echo]),
    ).toEqual([user("0"), agent("0"), user("1"), ...btw, agent("1"), echo]);
  });

  it("drops a persisted live turn that came before one the page holds but is not in it", () => {
    // Older than the page: `earlier` reaches it, the page does not.
    const older = agent("-5");
    expect(mergeRestoredTurns(page, [older, user("1"), agent("1")])).toEqual(
      page,
    );
  });

  it("draws narration once: by its place before a held turn, by its text after the last", () => {
    const note = system("已存档", "narration");
    const withNote = [...page, note];
    expect(mergeRestoredTurns(withNote, [user("1"), agent("1"), note])).toEqual(
      withNote,
    );
    // Written after the read: the page does not hold it.
    const later = system("又存了一次", "narration");
    expect(mergeRestoredTurns(page, [agent("1"), later])).toEqual([
      ...page,
      later,
    ]);
    // Before a turn the page holds, it is persisted — so in the page.
    const pageWithEarlyNote = [user("0"), note, agent("0")];
    expect(mergeRestoredTurns(pageWithEarlyNote, [note, agent("0")])).toEqual(
      pageWithEarlyNote,
    );
  });
});
