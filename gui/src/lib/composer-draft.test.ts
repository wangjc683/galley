import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** A localStorage stand-in: node has none. `failWrites` makes every
 * `setItem` throw the way a full quota does. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  failWrites = false;

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException("full", "QuotaExceededError");
    this.items.set(key, value);
  }
}

describe("composer-draft on disk", () => {
  let storage: MemoryStorage;

  /** A fresh module instance reading `storage`: an app start. */
  async function startApp(): Promise<typeof import("./composer-draft")> {
    vi.resetModules();
    return import("./composer-draft");
  }

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a draft's text across a restart, without its images", async () => {
    const before = await startApp();
    before.saveComposerDraft("s-main", { text: "下周三的会", images: [image] });
    before.saveComposerDraft("empty-state", {
      text: "新对话里写了一半",
      images: [],
    });
    expect(storage.getItem("galley.draft.s-main")).toBe("下周三的会");

    const after = await startApp();
    expect(after.readComposerDraft("s-main")).toEqual({
      text: "下周三的会",
      images: [],
    });
    expect(after.readComposerDraft("empty-state")?.text).toBe(
      "新对话里写了一半",
    );
  });

  it("writes only the key that changed, and not an unchanged text", async () => {
    const drafts = await startApp();
    drafts.saveComposerDraft("a", { text: "A", images: [] });
    const setItem = vi.spyOn(storage, "setItem");
    drafts.saveComposerDraft("a", { text: "A", images: [image] });
    expect(setItem).not.toHaveBeenCalled();
    drafts.saveComposerDraft("b", { text: "B", images: [] });
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith("galley.draft.b", "B");
  });

  it("deletes the stored text when the draft empties, is sent or dropped", async () => {
    const drafts = await startApp();
    drafts.saveComposerDraft("a", { text: "还在写", images: [] });
    drafts.saveComposerDraft("a", { text: "  \n", images: [] });
    expect(storage.getItem("galley.draft.a")).toBeNull();

    drafts.saveComposerDraft("b", { text: "要发的", images: [] });
    drafts.dropComposerDraft("b");
    expect(storage.getItem("galley.draft.b")).toBeNull();

    // Text cleared, an image left: the image stays in memory, nothing
    // stays on disk.
    drafts.saveComposerDraft("c", { text: "配图说明", images: [image] });
    drafts.saveComposerDraft("c", { text: "", images: [image] });
    expect(storage.getItem("galley.draft.c")).toBeNull();
    expect(drafts.readComposerDraft("c")?.images).toHaveLength(1);

    const after = await startApp();
    expect(after.readComposerDraft("a")).toBeUndefined();
    expect(after.readComposerDraft("b")).toBeUndefined();
    expect(after.readComposerDraft("c")).toBeUndefined();
  });

  it("a restored draft that is then sent is gone after the next restart", async () => {
    storage.setItem("galley.draft.s-1", "上次没发的");
    const drafts = await startApp();
    expect(drafts.readComposerDraft("s-1")?.text).toBe("上次没发的");
    drafts.dropComposerDraft("s-1");
    expect(storage.length).toBe(0);
  });

  it("falls back to memory when the quota is full, leaving no stale text", async () => {
    const drafts = await startApp();
    drafts.saveComposerDraft("a", { text: "旧的", images: [] });
    storage.failWrites = true;
    drafts.saveComposerDraft("a", { text: "旧的，加了一大段", images: [] });
    expect(drafts.readComposerDraft("a")?.text).toBe("旧的，加了一大段");
    // The older text must not come back after a restart.
    expect(storage.getItem("galley.draft.a")).toBeNull();
    // And once writes work again, the next change is stored.
    storage.failWrites = false;
    drafts.saveComposerDraft("a", { text: "旧的，加了一大段。", images: [] });
    expect(storage.getItem("galley.draft.a")).toBe("旧的，加了一大段。");
  });

  it("works from memory alone when storage cannot be reached", async () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("denied", "SecurityError");
      },
    });
    const drafts = await startApp();
    drafts.saveComposerDraft("a", { text: "只在内存", images: [] });
    expect(drafts.readComposerDraft("a")?.text).toBe("只在内存");
    drafts.dropComposerDraft("a");
    expect(drafts.readComposerDraft("a")).toBeUndefined();
  });

  it("keeps quotes across a restart, with the text (ticket 07)", async () => {
    const before = await startApp();
    before.saveComposerDraft("s-main", {
      text: "这两处什么意思",
      images: [image],
      quotes: ["第一处", "第二处\n第二行"],
    });
    before.saveComposerDraft("s-only", {
      text: "",
      images: [],
      quotes: ["只引用了，还没写"],
    });
    expect(storage.getItem("galley.draft.s-main")).toBe(
      JSON.stringify({
        galleyDraft: 2,
        text: "这两处什么意思",
        quotes: ["第一处", "第二处\n第二行"],
      }),
    );

    const after = await startApp();
    expect(after.readComposerDraft("s-main")).toEqual({
      text: "这两处什么意思",
      images: [],
      quotes: ["第一处", "第二处\n第二行"],
    });
    expect(after.readComposerDraft("s-only")).toEqual({
      text: "",
      images: [],
      quotes: ["只引用了，还没写"],
    });
  });

  it("stores a draft without quotes as bare text, and reads old bare text", async () => {
    // Written before quotes existed, and text that merely looks like JSON.
    storage.setItem("galley.draft.old", "旧版存的纯文字");
    storage.setItem("galley.draft.json", '{"galleyDraft":2,"text":');
    const drafts = await startApp();
    expect(drafts.readComposerDraft("old")).toEqual({
      text: "旧版存的纯文字",
      images: [],
    });
    expect(drafts.readComposerDraft("json")?.text).toBe(
      '{"galleyDraft":2,"text":',
    );
    drafts.saveComposerDraft("old", {
      text: "旧版存的纯文字，接着写",
      images: [],
      quotes: [],
    });
    expect(storage.getItem("galley.draft.old")).toBe("旧版存的纯文字，接着写");
  });

  it("deletes the stored draft when its last quote and text go", async () => {
    const drafts = await startApp();
    drafts.saveComposerDraft("q", { text: "", images: [], quotes: ["一段"] });
    expect(storage.getItem("galley.draft.q")).not.toBeNull();
    drafts.saveComposerDraft("q", { text: "", images: [], quotes: [] });
    expect(storage.getItem("galley.draft.q")).toBeNull();
    expect(drafts.readComposerDraft("q")).toBeUndefined();
  });

  it("leaves other localStorage keys alone and drops blank stored drafts", async () => {
    storage.setItem("galley_theme_preference", "dark");
    storage.setItem("galley.draft.blank", "   ");
    const drafts = await startApp();
    expect(drafts.readComposerDraft("blank")).toBeUndefined();
    expect(storage.getItem("galley.draft.blank")).toBeNull();
    expect(storage.getItem("galley_theme_preference")).toBe("dark");
  });
});
