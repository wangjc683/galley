import { describe, expect, it } from "vitest";

import {
  dropComposerDraft,
  readComposerDraft,
  saveComposerDraft,
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
});
