import { afterEach, describe, expect, it, vi } from "vitest";

type ResizeCallback = (entries: { target: Element }[]) => void;

let resizeCallback: ResizeCallback | null = null;
const observedByResize = new Set<Element>();

class FakeResizeObserver {
  constructor(callback: ResizeCallback) {
    resizeCallback = callback;
  }
  observe(el: Element) {
    observedByResize.add(el);
    resizeCallback?.([{ target: el }]);
  }
  unobserve(el: Element) {
    observedByResize.delete(el);
  }
  disconnect() {}
}

async function load() {
  vi.resetModules();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return import("./truncation-fade");
}

/** A stand-in for the DOM node: the module only reads the two widths
 * and writes `dataset` (gui tests run in node, without a DOM). */
function line(scrollWidth: number, clientWidth: number) {
  return { scrollWidth, clientWidth, dataset: {} as DOMStringMap };
}
const asEl = (fake: ReturnType<typeof line>) => fake as unknown as HTMLElement;
const isCut = (fake: ReturnType<typeof line>) => "truncated" in fake.dataset;

afterEach(() => {
  vi.unstubAllGlobals();
  resizeCallback = null;
  observedByResize.clear();
});

describe("truncationFadeRef", () => {
  it("marks only lines that are actually cut", async () => {
    const { truncationFadeRef } = await load();
    const cut = line(320, 240);
    const fits = line(200, 240);
    truncationFadeRef(asEl(cut));
    truncationFadeRef(asEl(fits));
    expect(isCut(cut)).toBe(true);
    expect(isCut(fits)).toBe(false);
  });

  it("re-syncs when the box resizes", async () => {
    const { truncationFadeRef } = await load();
    const el = line(260, 240);
    truncationFadeRef(asEl(el));
    expect(isCut(el)).toBe(true);
    el.clientWidth = 300; // e.g. the sidebar was dragged wider
    resizeCallback?.([{ target: asEl(el) }]);
    expect(isCut(el)).toBe(false);
  });

  it("stops observing on cleanup", async () => {
    const { truncationFadeRef } = await load();
    const el = asEl(line(320, 240));
    const cleanup = truncationFadeRef(el);
    expect(observedByResize.has(el)).toBe(true);
    cleanup?.();
    expect(observedByResize.has(el)).toBe(false);
  });

  it("is a no-op without ResizeObserver", async () => {
    vi.resetModules();
    vi.stubGlobal("ResizeObserver", undefined);
    const { truncationFadeRef } = await import("./truncation-fade");
    const el = line(320, 240);
    expect(() => truncationFadeRef(asEl(el))).not.toThrow();
    expect(isCut(el)).toBe(false);
  });
});
