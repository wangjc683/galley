import { describe, expect, it, vi } from "vitest";

import {
  dropComposerDraft,
  readComposerDraft,
  saveComposerDraft,
  subscribeComposerDrafts,
} from "./composer-draft";

import type { PendingImageAttachment } from "@/types/conversation";

const image: PendingImageAttachment = {
  id: "img-1",
  dataUrl: "data:image/png;base64,xxxx",
  previewUrl: "blob:preview-1",
  mimeType: "image/png",
  byteSize: 4,
};

describe("composer-draft", () => {
  it("round-trips a text draft", () => {
    saveComposerDraft("s1", { text: "半截草稿", images: [] });
    expect(readComposerDraft("s1")).toEqual({ text: "半截草稿", images: [] });
    dropComposerDraft("s1");
    expect(readComposerDraft("s1")).toBeUndefined();
  });

  it("keeps a draft that has only images", () => {
    saveComposerDraft("s2", { text: "", images: [image] });
    expect(readComposerDraft("s2")?.images).toHaveLength(1);
    dropComposerDraft("s2");
  });

  it("deletes the entry when the draft empties out", () => {
    saveComposerDraft("s3", { text: "还在写", images: [] });
    // Whitespace-only counts as empty — matches the submit gate's trim.
    saveComposerDraft("s3", { text: "   \n", images: [] });
    expect(readComposerDraft("s3")).toBeUndefined();
  });

  it("keys drafts independently", () => {
    saveComposerDraft("a", { text: "A 的草稿", images: [] });
    saveComposerDraft("b", { text: "B 的草稿", images: [] });
    expect(readComposerDraft("a")?.text).toBe("A 的草稿");
    expect(readComposerDraft("b")?.text).toBe("B 的草稿");
    dropComposerDraft("a");
    expect(readComposerDraft("b")?.text).toBe("B 的草稿");
    dropComposerDraft("b");
  });

  it("tells subscribers about saves and drops, and only real changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeComposerDrafts(listener);
    saveComposerDraft("main", { text: "下周三", images: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    const first = readComposerDraft("main");
    // Another key's write leaves this key's entry as it was.
    saveComposerDraft("other", { text: "别处", images: [] });
    expect(readComposerDraft("main")).toBe(first);
    expect(listener).toHaveBeenCalledTimes(2);
    // Emptying an absent key, or dropping one, changes nothing to hear.
    saveComposerDraft("absent", { text: " ", images: [] });
    dropComposerDraft("absent");
    expect(listener).toHaveBeenCalledTimes(2);
    dropComposerDraft("main");
    expect(listener).toHaveBeenCalledTimes(3);
    saveComposerDraft("other", { text: "", images: [] });
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    saveComposerDraft("main", { text: "听不到了", images: [] });
    expect(listener).toHaveBeenCalledTimes(4);
    dropComposerDraft("main");
  });
});
