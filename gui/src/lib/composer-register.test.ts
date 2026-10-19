import { describe, expect, it } from "vitest";
import {
  composerRegisterCopyKey,
  resolveComposerRegister,
} from "./composer-register";

describe("resolveComposerRegister", () => {
  it("only offers the chip hint when the pending question has candidates", () => {
    const idle = { isRunning: false, pendingAskUser: true };
    expect(resolveComposerRegister({ ...idle, askUserHasCandidates: true })).toBe(
      "reply",
    );
    expect(
      resolveComposerRegister({ ...idle, askUserHasCandidates: false }),
    ).toBe("replyOpen");
    expect(composerRegisterCopyKey("reply")).toBe("replyToContinue");
    expect(composerRegisterCopyKey("replyOpen")).toBe("replyOpen");
  });
  it("keeps running and idle registers unchanged", () => {
    expect(
      resolveComposerRegister({
        isRunning: true,
        pendingAskUser: true,
        askUserHasCandidates: true,
      }),
    ).toBe("byTheWay");
    expect(
      resolveComposerRegister({
        isRunning: false,
        pendingAskUser: false,
        askUserHasCandidates: false,
      }),
    ).toBe("continuing");
  });
  it("the main chat says 「发消息…」 at rest and while it works; its questions keep the reply registers (ruling 71)", () => {
    const main = { mainChat: true, askUserHasCandidates: false };
    expect(
      resolveComposerRegister({
        ...main,
        isRunning: false,
        pendingAskUser: false,
      }),
    ).toBe("messaging");
    expect(
      resolveComposerRegister({
        ...main,
        isRunning: true,
        pendingAskUser: false,
      }),
    ).toBe("messaging");
    expect(
      resolveComposerRegister({
        ...main,
        isRunning: false,
        pendingAskUser: true,
      }),
    ).toBe("replyOpen");
    expect(
      resolveComposerRegister({
        ...main,
        isRunning: false,
        pendingAskUser: true,
        askUserHasCandidates: true,
      }),
    ).toBe("reply");
    expect(composerRegisterCopyKey("messaging")).toBe("writeMessage");
  });
  it("says where to answer when an opened subtask's question is with Galley, over anything else (ruling 102)", () => {
    for (const isRunning of [false, true]) {
      for (const pendingAskUser of [false, true]) {
        expect(
          resolveComposerRegister({
            isRunning,
            pendingAskUser,
            askUserHasCandidates: true,
            questionWithGalley: true,
          }),
        ).toBe("withGalley");
      }
    }
    expect(composerRegisterCopyKey("withGalley")).toBe("answerWithGalley");
  });
});
