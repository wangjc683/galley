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
});
