// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { TodoPanel } from "@/components/todo/TodoPanel";
import { revealInList } from "@/hooks/useTodoPanelFlash";
import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import { BUBBLE_MOTION_TOKENS } from "@/lib/bubble-motion";
import { CopyProvider } from "@/lib/i18n";
import { TODO_SETTLE_MS } from "@/lib/todo-panel";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useUiStore } from "@/stores/ui";

/*
 * The to-do panel's rows leaving and closing up, through the real panel
 * and stores (main chat PRD ruling 208 point 3, ticket 161). jsdom has no
 * layout and no Web Animations, so the page here is a fake: the list is a
 * viewport 100px down the window; its blocks stack from 8px into it —
 * a row 51px (open, 140), a group's label 22, 「还有 N 件」 32, 12px
 * between groups, 16px under the last — each drawn where its slide on
 * the way puts it, a copy in the layer where its style does; the scroll
 * position is clamped to the content as a browser does. `animate` records
 * what was played. Which block leaves, stays or comes is pinned in
 * lib/todo-row-motion.test.ts; this is the wiring: when it plays, from
 * what it reads, and what it leaves on the page.
 */

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

// ---- The page ----------------------------------------------------------------

interface FakeAnimation {
  cancel: Mock<() => void>;
  finished: Promise<FakeAnimation>;
  /** Its eased progress now, as `getComputedTiming()` gives it. */
  progress: number | null;
  effect: { getComputedTiming: () => { progress: number | null } };
  cancelled: boolean;
  ended: boolean;
  end: () => void;
}

interface Played {
  el: Element;
  keyframes: PropertyIndexedKeyframes;
  options: KeyframeAnimationOptions;
  animation: FakeAnimation;
}

const LIST_TOP = 100;
const layout = { view: 600, scrollTop: 0 };
let played: Played[] = [];

const LAYER = "data-todo-row-motion-layer";
const isList = (el: Element) => el.hasAttribute("data-todo-page");

function blockHeight(el: Element): number {
  if (el.hasAttribute("data-todo-row")) {
    return el.hasAttribute("data-todo-open") ? 140 : 51;
  }
  const role = el.getAttribute("data-role");
  if (role === "todo-empty") return 120;
  if (role === "todo-autostart-hint") return 60;
  if (el.tagName === "P") return 32;
  if (el.parentElement?.hasAttribute("data-todo-group")) return 22;
  return 0;
}

/** Every block's top in the scroll content, and the content's height. */
function contentOf(list: Element): {
  tops: Map<Element, number>;
  height: number;
} {
  const tops = new Map<Element, number>();
  let y = 8;
  for (const child of Array.from(list.children)) {
    if (child.hasAttribute(LAYER)) continue;
    if (child.getAttribute("data-role") !== "todo-groups") {
      tops.set(child, y);
      y += blockHeight(child);
      continue;
    }
    Array.from(child.children).forEach((group, at) => {
      if (at > 0) y += 12;
      for (const block of Array.from(group.children)) {
        tops.set(block, y);
        y += blockHeight(block);
      }
    });
  }
  return { tops, height: y + 16 };
}

const latest = (el: Element, property: "transform" | "opacity") =>
  [...played]
    .reverse()
    .find(
      (p) =>
        p.el === el &&
        p.keyframes[property] !== undefined &&
        !p.animation.cancelled &&
        !p.animation.ended,
    );

/** Where a slide on the way has `el` now (px below its place). */
function slidOffset(el: Element): number {
  const slide = latest(el, "transform");
  if (!slide) return 0;
  const from = Number.parseFloat(
    /translateY\((-?[\d.]+)px\)/.exec(
      String((slide.keyframes.transform as string[])[0]),
    )?.[1] ?? "0",
  );
  return from * (1 - (slide.animation.progress ?? 0));
}

function rect(top: number, height: number, left = 8, width = 304): DOMRect {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    height,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function maxScroll(list: Element): number {
  return Math.max(0, contentOf(list).height - layout.view);
}

/** The scroll position, taken back by a shorter list as a browser does
 * at layout. */
function scrollOf(list: Element): number {
  layout.scrollTop = Math.min(layout.scrollTop, maxScroll(list));
  return layout.scrollTop;
}

/** The tokens as globals.css defines them. */
function tokens(): Record<string, string> {
  const css = readFileSync(
    path.resolve(__dirname, "../styles/globals.css"),
    "utf8",
  );
  const out: Record<string, string> = {};
  for (const name of Object.values(BUBBLE_MOTION_TOKENS)) {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
    if (match) out[name] = match[1];
  }
  return out;
}

function installPage(): void {
  played = [];
  layout.view = 600;
  layout.scrollTop = 0;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (isList(this)) return rect(LIST_TOP, layout.view, 0, 320);
      const list = this.closest("[data-todo-page]");
      if (!list) return rect(0, 0);
      const scroll = scrollOf(list);
      const style = (this as HTMLElement).style;
      if (style.position === "absolute" && style.top) {
        return rect(
          LIST_TOP + Number.parseFloat(style.top) - scroll,
          Number.parseFloat(style.height),
          Number.parseFloat(style.left),
          Number.parseFloat(style.width),
        );
      }
      // The block it is in: itself, or the nearest around it.
      const { tops } = contentOf(list);
      const block = [...tops.keys()].find((each) => each.contains(this));
      if (!block) return rect(0, 0);
      return rect(
        LIST_TOP + tops.get(block)! - scroll + slidOffset(block),
        blockHeight(block),
      );
    },
  );
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(
    function (this: Element) {
      return isList(this) ? layout.view : 0;
    },
  );
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (
    this: Element,
  ) {
    return isList(this) ? scrollOf(this) : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
    this: Element,
    value: number,
  ) {
    if (isList(this)) {
      layout.scrollTop = Math.max(0, Math.min(value, maxScroll(this)));
    }
  });
  const values = tokens();
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = computed(element);
    if (element !== document.documentElement) return style;
    return {
      getPropertyValue: (name: string) =>
        values[name] ?? style.getPropertyValue(name),
    } as CSSStyleDeclaration;
  });
  Element.prototype.animate = function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    let resolve: (a: FakeAnimation) => void = () => {};
    const animation: FakeAnimation = {
      cancel: vi.fn(() => {
        animation.cancelled = true;
      }),
      finished: new Promise<FakeAnimation>((r) => {
        resolve = r;
      }),
      progress: null,
      effect: { getComputedTiming: () => ({ progress: animation.progress }) },
      cancelled: false,
      ended: false,
      end: () => {
        animation.ended = true;
        resolve(animation);
      },
    };
    played.push({
      el: this,
      keyframes: (keyframes ?? {}) as PropertyIndexedKeyframes,
      options: (typeof options === "number"
        ? { duration: options }
        : (options ?? {})) as KeyframeAnimationOptions,
      animation,
    });
    return animation as unknown as Animation;
  };
}

function uninstallPage(): void {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
}

// ---- The panel ---------------------------------------------------------------

function todo(id: string, extra: Partial<TodoItem> = {}): TodoItem {
  return {
    kind: "todo",
    id,
    text: id,
    state: "open",
    createdBy: "assistant",
    createdIn: { sessionId: "s-main", turnIndex: 4 },
    ...extra,
  };
}
const done = (item: TodoItem, extra: Partial<TodoItem> = {}): TodoItem => ({
  ...item,
  state: "done",
  ...extra,
});
const A = todo("todo_a");
const B = todo("todo_b");
const C = todo("todo_c");
const D = todo("todo_d");
const E = todo("todo_e");
const OLD = done(todo("todo_old"));
const list = (yours: TodoItem[], finished: TodoItem[] = []): AssistantTodo => ({
  ...EMPTY_TODO,
  yours: { today: [], later: [], anytime: yours },
  done: finished,
});

let root: Root | null = null;
beforeEach(() => {
  installPage();
  useAssistantTodoStore.setState({
    todo: list([A, B, C], [OLD]),
    noted: [],
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
    deleting: {},
    editing: {},
  });
  useUiStore.setState({
    todoPanelOpen: { galley: false, elsewhere: false },
    todoNarrow: false,
    todoGlance: null,
    todoPanelIntroduced: false,
    todoRowRequest: null,
    todoPageRequest: null,
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  uninstallPage();
});

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>
          <TodoPanel
            mainChatId="s-main"
            spot={{ here: "galley", at: "main:s-main", narrow: false }}
            onOpenSession={() => {}}
            onTalk={() => {}}
            onClose={() => {}}
          />
        </Tooltip.Provider>
      </CopyProvider>,
    );
  });
  return container;
}

/** A write to the to-do store, and the commit it brings. */
function write(
  state: Partial<ReturnType<typeof useAssistantTodoStore.getState>>,
) {
  act(() => useAssistantTodoStore.setState(state));
}

/** Your ticks of `ids` settled, as the store writes them: on their way to
 * Core (its read has nothing new yet), then the fresh list read back and
 * the ticks let go in one write. Without the first, the list moving a row
 * to 已完成 reads as Galley's tick, held where it stood. */
function tick(ids: string[], next: AssistantTodo) {
  write({
    flips: Object.fromEntries(
      ids.map((id) => [id, { done: true, phase: "saving" as const }]),
    ),
  });
  write({ todo: next, flips: {} });
}

const listOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-todo-page]")!;
const row = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-todo-row="${id}"]`)!;
const doneLabel = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-todo-group="done"] > button')!;
const copies = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>(
      `[${LAYER}] [data-role="todo-row-leaving"]`,
    ),
  );

/** The slide played on `el`, from px below its place; null without one. */
function slideOf(el: Element): number | null {
  const slide = latest(el, "transform");
  if (!slide) return null;
  expect(slide.keyframes.transform).toEqual([
    expect.stringMatching(/^translateY\(-?[\d.]+px\)$/),
    "translateY(0px)",
  ]);
  return Number.parseFloat(
    /translateY\((-?[\d.]+)px\)/.exec(
      String((slide.keyframes.transform as string[])[0]),
    )![1],
  );
}
const fadeOf = (el: Element) => latest(el, "opacity");
/** Every motion played so far to its end. */
function endAll(): void {
  for (const p of played) p.animation.end();
}
const slid = () =>
  played.filter((p) => p.keyframes.transform !== undefined).map((p) => p.el);

async function microtasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("a row leaving", () => {
  it("ticked off and settled: a copy fades where it stood, the rows under it close up, 已完成's count steps", async () => {
    const container = mount();
    const b = row(container, "todo_b");
    tick(["todo_b"], list([A, C], [done(B), OLD]));

    const [copy] = copies(container);
    expect(copies(container)).toHaveLength(1);
    // Where the row stood: the second row, 59px into the list.
    expect(copy.style.top).toBe("59px");
    expect(copy.style.height).toBe("51px");
    expect(copy.textContent).toBe(b.textContent);
    // Found by nothing that looks rows up.
    expect(copy.hasAttribute("data-todo-row")).toBe(false);
    expect(copy.querySelector("[id], [data-todo-row]")).toBeNull();
    const leave = fadeOf(copy)!;
    expect(leave.keyframes.opacity).toEqual([1, 0]);
    expect(leave.options).toMatchObject({
      duration: 160,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });

    expect(slideOf(row(container, "todo_a"))).toBeNull();
    expect(slideOf(row(container, "todo_c"))).toBe(51);
    // The group's label under them closes up too.
    expect(slideOf(doneLabel(container))).toBe(51);
    const slide = latest(row(container, "todo_c"), "transform")!;
    expect(slide.options).toMatchObject({
      duration: 240,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });

    const count = container.querySelector('[data-role="group-count"]')!;
    expect(count.textContent).toBe("2");
    expect(count.classList.contains("sidebar-step-tick")).toBe(true);

    // The copy goes with its fade, the layer with its last copy.
    leave.animation.end();
    await microtasks();
    expect(copies(container)).toHaveLength(0);
    expect(container.querySelector(`[${LAYER}]`)).toBeNull();
  });

  it("deleted, then put back by 撤销: it fades in at its place once the rows under it have made room", () => {
    const container = mount();
    write({ deleting: { todo_b: { order: 1, committing: false } } });
    expect(copies(container)).toHaveLength(1);
    expect(slideOf(row(container, "todo_c"))).toBe(51);
    endAll();

    write({ deleting: {} });
    const back = row(container, "todo_b");
    expect(slideOf(back)).toBeNull();
    const enter = fadeOf(back)!;
    expect(enter.keyframes.opacity).toEqual([0, 1]);
    expect(enter.options).toMatchObject({
      duration: 160,
      delay: 120,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "backwards",
    });
    expect(slideOf(row(container, "todo_c"))).toBe(-51);
  });

  it("two at once: each row under them by what left above it", () => {
    useAssistantTodoStore.setState({ todo: list([A, B, C, D], [OLD]) });
    const container = mount();
    tick(["todo_a", "todo_c"], list([B, D], [done(A), done(C), OLD]));
    expect(copies(container).map((copy) => copy.style.top)).toEqual([
      "8px",
      "110px",
    ]);
    expect(slideOf(row(container, "todo_b"))).toBe(51);
    expect(slideOf(row(container, "todo_d"))).toBe(102);
  });

  it("Galley's tick: held where it stood, then closes up as it goes to 已完成", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const container = mount();
    write({ todo: list([A, C], [done(B, { doneBy: "assistant" }), OLD]) });
    // Held in place, ticked: nothing has moved.
    expect(played).toEqual([]);

    act(() => vi.advanceTimersByTime(TODO_SETTLE_MS));
    expect(copies(container)).toHaveLength(1);
    expect(copies(container)[0].style.top).toBe("59px");
    expect(slideOf(row(container, "todo_c"))).toBe(51);
  });
});

describe("a row moving", () => {
  it("to a new day: it and the rows it passed slide by the real distance", () => {
    const container = mount();
    write({ todo: list([C, A, B], [OLD]) });
    expect(slideOf(row(container, "todo_c"))).toBe(102);
    expect(slideOf(row(container, "todo_a"))).toBe(-51);
    expect(slideOf(row(container, "todo_b"))).toBe(-51);
    expect(copies(container)).toHaveLength(0);
  });

  it("is scrolled to by where it ends up, not where it is passing", () => {
    layout.view = 100;
    const container = mount();
    write({ todo: list([C, A, B], [OLD]) });
    // On its way from 110px down, seen below the view; its place is the
    // first row's, in view: nothing to scroll.
    const c = row(container, "todo_c");
    expect(c.getBoundingClientRect().top).toBe(LIST_TOP + 110);
    revealInList(listOf(container), c);
    expect(layout.scrollTop).toBe(0);
  });
});

describe("a row moving under its open date popover", () => {
  /** B open, its date popover open under its time line. */
  function openDate(container: HTMLElement) {
    act(() =>
      row(container, "todo_b")
        .querySelector<HTMLButtonElement>("button[aria-expanded]")!
        .click(),
    );
    const trigger = row(container, "todo_b").querySelector<HTMLElement>(
      '[data-role="todo-meta-date"], [data-role="todo-add-date"]',
    )!;
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  }
  async function frame() {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  }

  it("does not slide when it stays open into the frame (a time changed; Galley moved it)", async () => {
    const container = mount();
    openDate(container);
    write({ todo: list([A, C, B], [OLD]) });
    const b = latest(row(container, "todo_b"), "transform")!;
    const c = latest(row(container, "todo_c"), "transform")!;
    expect(b).toBeDefined();
    await frame();
    // Gone to their places before the frame is painted.
    expect(b.animation.cancelled).toBe(true);
    expect(c.animation.cancelled).toBe(true);
  });

  it("slides when the popover closes with the change (a day picked)", async () => {
    const container = mount();
    openDate(container);
    write({ todo: list([A, C, B], [OLD]) });
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(
      container.querySelector(
        '[data-role="todo-meta-date"][aria-expanded="true"]',
      ),
    ).toBeNull();
    await frame();
    expect(slideOf(row(container, "todo_b"))).toBe(-51);
    expect(slideOf(row(container, "todo_c"))).toBe(140);
  });
});

describe("only what is on screen moves", () => {
  it("leaves the rows below the view where they end up", () => {
    useAssistantTodoStore.setState({ todo: list([A, B, C, D, E], [OLD]) });
    layout.view = 120;
    const container = mount();
    tick(["todo_a"], list([B, C, D, E], [done(A), OLD]));
    // B and C were in view; D comes into it; E and the label stay below.
    expect(slid()).toEqual([
      row(container, "todo_b"),
      row(container, "todo_c"),
      row(container, "todo_d"),
    ]);
  });

  it("reads the scroll a shorter list gave back: what stood above slides down to where it is drawn", () => {
    useAssistantTodoStore.setState({ todo: list([A, B, C, D, E]) });
    layout.view = 120;
    const container = mount();
    act(() => {
      listOf(container).scrollTop = 1000;
    });
    // Content 8 + 5 × 51 + 16 = 279: scrolled to its end, 159.
    expect(layout.scrollTop).toBe(159);
    write({ todo: list([A, B, C, D]) });
    // 228 now: the browser took 51px back.
    expect(layout.scrollTop).toBe(108);
    // E's copy stays where it was seen (53px into the view), in the
    // scroll content's terms now.
    expect(copies(container)[0].style.top).toBe("161px");
    // B comes 2px into the view; A is above it before and after.
    expect(slideOf(row(container, "todo_b"))).toBe(-51);
    expect(slideOf(row(container, "todo_c"))).toBe(-51);
    expect(slideOf(row(container, "todo_d"))).toBe(-51);
    expect(slideOf(row(container, "todo_a"))).toBeNull();
  });
});

describe("only what happens in front of you plays", () => {
  it("not at mounting, nor a read that changes no order", () => {
    mount();
    write({ todo: list([{ ...A, text: "交周报" }, B, C], [OLD]) });
    expect(played).toEqual([]);
  });

  it("not at the first read", () => {
    useAssistantTodoStore.setState({ todo: EMPTY_TODO, loaded: false });
    mount();
    write({ todo: list([A, B, C], [OLD]), loaded: true });
    expect(played).toEqual([]);
  });

  it("not on opening a row, nor unfolding 已完成", () => {
    const container = mount();
    act(() =>
      row(container, "todo_b")
        .querySelector<HTMLButtonElement>("button[aria-expanded]")!
        .click(),
    );
    expect(row(container, "todo_b").hasAttribute("data-todo-open")).toBe(true);
    act(() => doneLabel(container).click());
    expect(row(container, "todo_old")).not.toBeNull();
    expect(played).toEqual([]);
  });

  it("not on turning to 备忘 and back, whatever changed meanwhile", () => {
    const container = mount();
    const page = (label: string) =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          '[data-role="todo-panel-pages"] [role="radio"]',
        ),
      )
        .find((el) => el.textContent === label)!
        .click();
    act(() => page("备忘"));
    tick(["todo_b"], list([A, C], [done(B), OLD]));
    act(() => page("待办"));
    expect(row(container, "todo_c")).not.toBeNull();
    expect(played).toEqual([]);
  });
});

describe("a change while one is moving", () => {
  it("goes on from where things are seen", () => {
    const container = mount();
    tick(["todo_b"], list([A, C], [done(B), OLD]));
    const c = row(container, "todo_c");
    const first = latest(c, "transform")!;
    first.animation.progress = 0.5;
    // C is seen 25.5px below its place; A leaves now.
    tick(["todo_a"], list([C], [done(A), done(B), OLD]));
    expect(first.animation.cancelled).toBe(true);
    expect(slideOf(c)).toBe(76.5);
    // B's copy fades on where it stood.
    expect(copies(container)).toHaveLength(2);
  });

  it("goes on fading in what was coming in, at once", () => {
    const container = mount();
    write({ deleting: { todo_b: { order: 1, committing: false } } });
    write({ deleting: {} });
    const b = row(container, "todo_b");
    fadeOf(b)!.animation.progress = 0.5;
    tick(["todo_c"], list([A, B], [done(C), OLD]));
    const fade = fadeOf(b)!;
    expect(fade.keyframes.opacity).toEqual([0.5, 1]);
    expect(fade.options.delay).toBe(0);
  });
});

describe("under reduced motion", () => {
  it("only fades: nothing slides", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    const container = mount();
    tick(["todo_b"], list([A, C], [done(B), OLD]));
    expect(slid()).toEqual([]);
    expect(copies(container)).toHaveLength(1);
    write({ todo: list([A, C, D], [done(B), OLD]) });
    expect(slid()).toEqual([]);
    expect(fadeOf(row(container, "todo_d"))!.options.delay).toBe(0);
  });
});

describe("a copy", () => {
  it("does not play the row's own CSS animations over: they are at their end", () => {
    const finish = vi.fn();
    const asked: Element[] = [];
    (
      Element.prototype as { getAnimations?: () => Partial<Animation>[] }
    ).getAnimations = function (this: Element) {
      asked.push(this);
      return [{ finish }];
    };
    try {
      const container = mount();
      tick(["todo_b"], list([A, C], [done(B), OLD]));
      const [copy] = copies(container);
      expect(asked).toEqual([copy]);
      expect(finish).toHaveBeenCalledTimes(1);
    } finally {
      delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
    }
  });
});

describe("without Web Animations", () => {
  it("everything is just where it ends up", () => {
    delete (Element.prototype as { animate?: unknown }).animate;
    const container = mount();
    tick(["todo_b"], list([A, C], [done(B), OLD]));
    expect(copies(container)).toHaveLength(0);
    expect(row(container, "todo_c")).not.toBeNull();
  });
});
