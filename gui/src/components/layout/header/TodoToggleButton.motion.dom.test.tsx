// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { EMPTY_TODO, type TodoItem } from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { TodoToggleButton } from "./TodoToggleButton";

/**
 * The 待办 button when today's count changes (main chat ticket 162, PRD
 * ruling 208 point 4): the number ticks from the first change on, every
 * change again, never at mount; the width glides from the old to the
 * new; a number that goes stays for the glide; under reduced motion the
 * width is where it ends up at once. jsdom lays nothing out and has no
 * Web Animations: the button's width is made up from what it draws, and
 * `animate` is recorded and finished by hand.
 */

vi.mock("@/hooks/useDayStamp", () => ({
  useDayStamp: () => new Date(2026, 9, 28).getTime(),
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipLabel: ({ children }: { text: string; children: ReactNode }) => (
    <>{children}</>
  ),
}));

/** One later to-do: the icon look, whatever today's count. */
const LATER: TodoItem = {
  kind: "todo",
  id: "later",
  text: "取快递",
  state: "open",
  createdBy: "user",
  due: { date: "2026-10-30", hasTime: false },
};

function today(id: string, hh: number): TodoItem {
  return {
    kind: "todo",
    id,
    text: `事 ${id}`,
    state: "open",
    createdBy: "user",
    due: {
      date: "2026-10-28",
      hasTime: true,
      at: new Date(2026, 9, 28, hh).toISOString(),
      time: `${hh}:00`,
    },
  };
}

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

/** What `animate` was asked for. */
interface Played {
  el: Element;
  keyframes: PropertyIndexedKeyframes;
  options: KeyframeAnimationOptions;
  finish: () => void;
  done: boolean;
  cancelled: boolean;
}

let host: HTMLDivElement;
let root: Root;
let played: Played[];
let reduced: boolean;
/** The header too narrow for the capsule: its row is not drawn. */
let narrow: boolean;

/** The hairline's colour, `--color-line` as the page resolves it. */
const LINE = "rgb(1, 2, 3)";
const NONE = "rgba(0, 0, 0, 0)";

/** The button's made-up width: 28px for the square, 4px and 8px a
 * character more for each thing drawn after the icon — not what is
 * hidden, as the hook hides the number that leaves to measure. Mid-glide,
 * halfway between the glide's ends. */
function madeUpWidth(button: HTMLElement): number {
  const gliding = played.find(
    (p) => p.el === button && "width" in p.keyframes && !p.done && !p.cancelled,
  );
  if (gliding) {
    const [from, to] = (gliding.keyframes.width as string[]).map(parseFloat);
    return (from + to) / 2;
  }
  let width = 28;
  for (const child of Array.from(button.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.style.display === "none") continue;
    // Placed over the button, out of its flow.
    if (child.hasAttribute("data-todo-capsule-leaving")) continue;
    width += 4 + 8 * (child.textContent ?? "").length;
  }
  return width;
}

/** The button's frame as its classes draw it: the capsule's hairline
 * and round ends, else none and rounded-md; the line where it is set
 * inline. */
function madeUpFrame(button: HTMLElement) {
  const capsule = button.dataset.shape === "capsule";
  const lined = capsule || button.style.getPropertyValue("border-color") !== "";
  return {
    borderTopColor: lined ? LINE : NONE,
    borderTopLeftRadius: capsule ? "9999px" : "6px",
    height: "28px",
  };
}

beforeEach(() => {
  played = [];
  reduced = false;
  narrow = false;
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element,
  ) {
    const hidden =
      (this instanceof HTMLElement && this.style.display === "none") ||
      (narrow && this.hasAttribute("data-todo-capsule-leaving"));
    return (hidden ? [] : [{}]) as unknown as DOMRectList;
  });
  Element.prototype.animate = function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    let resolve: () => void = () => {};
    let reject: (e: unknown) => void = () => {};
    const finished = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const entry: Played = {
      el: this,
      keyframes: keyframes as PropertyIndexedKeyframes,
      options: options as KeyframeAnimationOptions,
      finish: () => {
        entry.done = true;
        resolve();
      },
      done: false,
      cancelled: false,
    };
    played.push(entry);
    return {
      finished,
      cancel() {
        entry.cancelled = true;
        reject(new DOMException("cancelled", "AbortError"));
      },
    } as unknown as Animation;
  };
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
  }));
  const tokens: Record<string, string> = {
    "--motion-base": "160ms",
    "--ease-firm": "cubic-bezier(0.2, 0, 0, 1)",
  };
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    const style = computed(el, pseudo);
    if (el === document.documentElement) {
      return {
        getPropertyValue: (name: string) =>
          tokens[name] ?? style.getPropertyValue(name),
      } as CSSStyleDeclaration;
    }
    if (el instanceof HTMLElement && el.dataset.role === "topbar-todo") {
      return {
        width: `${madeUpWidth(el)}px`,
        ...madeUpFrame(el),
      } as CSSStyleDeclaration;
    }
    // The capsule's row: 8px a character.
    if (el instanceof HTMLElement && el.hasAttribute("data-capsule-body")) {
      return {
        width: `${8 * (el.textContent ?? "").length}px`,
      } as CSSStyleDeclaration;
    }
    return style;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => useAssistantTodoStore.setState({ todo: EMPTY_TODO }));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
});

function setList(
  todayCount: number,
  yours = {
    today: [] as TodoItem[],
    later: [LATER],
    anytime: [] as TodoItem[],
  },
) {
  act(() =>
    useAssistantTodoStore.setState({
      todo: { ...EMPTY_TODO, yours, todayCount },
    }),
  );
}

function mount() {
  act(() =>
    root.render(
      <CopyProvider language="zh-CN">
        <TodoToggleButton open={false} onToggle={() => {}} />
      </CopyProvider>,
    ),
  );
}

const button = () =>
  host.querySelector<HTMLButtonElement>('[data-role="topbar-todo"]')!;
/** The number after the icon (the icon look's). */
const number = () => button().querySelector<HTMLElement>(".tabular-nums");
const widthGlides = () =>
  played.filter((p) => p.el === button() && "width" in p.keyframes);

describe("the number's tick", () => {
  it("does not tick at mount, nor at a mount again (a conversation switched to)", () => {
    setList(2);
    mount();
    expect(number()?.textContent).toBe("2");
    expect(number()?.className).not.toContain("todo-count-tick");
    act(() => root.unmount());
    root = createRoot(host);
    mount();
    expect(number()?.className).not.toContain("todo-count-tick");
    expect(widthGlides()).toHaveLength(0);
  });

  it("ticks when N changes, each change in a new element so it plays again", () => {
    setList(2);
    mount();
    const first = number();
    setList(3);
    const second = number();
    expect(second?.textContent).toBe("3");
    expect(second?.className).toContain("todo-count-tick");
    expect(second).not.toBe(first);
    setList(2);
    const third = number();
    expect(third?.textContent).toBe("2");
    expect(third?.className).toContain("todo-count-tick");
    expect(third).not.toBe(second);
  });

  it("ticks a count that comes from none", () => {
    setList(0);
    mount();
    expect(number()).toBeNull();
    setList(1);
    expect(number()?.textContent).toBe("1");
    expect(number()?.className).toContain("todo-count-tick");
  });

  it("ticks the capsule's 「+N」 when today's count changes, not at mount", () => {
    const yours = {
      today: [today("a", 15), today("b", 18), today("c", 20)],
      later: [],
      anytime: [],
    };
    setList(3, yours);
    mount();
    const more = () =>
      button().querySelector<HTMLElement>("[data-capsule-body] .ml-1");
    expect(more()?.textContent).toBe("+2");
    expect(more()?.className).not.toContain("todo-count-tick");
    setList(2, { ...yours, today: yours.today.slice(1) });
    expect(more()?.textContent).toBe("+1");
    expect(more()?.className).toContain("todo-count-tick");
  });
});

describe("the width's glide", () => {
  it("glides from the old width to the new on --motion-base and --ease-firm, a digit more included", async () => {
    setList(9);
    mount();
    setList(10);
    const [glide] = widthGlides();
    // 28 + 4 + 8 for 「9」, then 8 more for 「10」.
    expect(glide.keyframes).toEqual({ width: ["40px", "48px"] });
    expect(glide.options).toEqual({
      duration: 160,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
    // Cut and on one line from the left while it glides; at rest, no
    // inline style at all.
    expect(button().style.overflow).toBe("hidden");
    expect(button().style.whiteSpace).toBe("nowrap");
    expect(button().style.justifyContent).toBe("flex-start");
    await act(async () => {
      glide.finish();
      await Promise.resolve();
    });
    expect(button().getAttribute("style") ?? "").toBe("");
  });

  it("keeps the number that goes at 0 for the glide, fading, then drops it", async () => {
    setList(1);
    mount();
    setList(0);
    // Still drawn, marked as leaving, with its key: the same element.
    const leaving = button().querySelector<HTMLElement>(
      "[data-todo-count-leaving]",
    );
    expect(leaving?.textContent).toBe("1");
    expect(button().getAttribute("aria-label")).toBe("待办与备忘");
    const [glide] = widthGlides();
    // From the number's width to the 28px square, measured without it.
    expect(glide.keyframes).toEqual({ width: ["40px", "28px"] });
    const fade = played.find((p) => p.el === leaving);
    expect(fade?.keyframes).toEqual({ opacity: ["1", "0"] });
    expect(fade?.options).toMatchObject({ duration: 160, fill: "forwards" });
    // Shown again after it was measured without.
    expect(leaving?.style.display).toBe("");
    await act(async () => {
      glide.finish();
      await Promise.resolve();
    });
    expect(number()).toBeNull();
    expect(button().getAttribute("style") ?? "").toBe("");
    // Measured without it as the glide let go: no second glide back.
    expect(widthGlides()).toHaveLength(1);
  });

  it("turns a glide round from where it stands when N changes again", () => {
    setList(1);
    mount();
    setList(0);
    const [first] = widthGlides();
    setList(1);
    expect(first.cancelled).toBe(true);
    // The leaving one is gone; the new count ticks in a new element.
    expect(button().querySelector("[data-todo-count-leaving]")).toBeNull();
    expect(number()?.className).toContain("todo-count-tick");
    // Back from halfway (34px), not from either end.
    const [, second] = widthGlides();
    expect(second.keyframes).toEqual({ width: ["34px", "40px"] });
  });

  it("glides when the look changes: the capsule to the icon as today's last goes", () => {
    setList(1, { today: [today("a", 15)], later: [LATER], anytime: [] });
    mount();
    expect(button().dataset.shape).toBe("capsule");
    setList(0, { today: [], later: [LATER], anytime: [] });
    expect(button().dataset.shape).toBe("icon");
    expect(widthGlides()).toHaveLength(1);
  });
});

describe("the capsule going and coming (after ticket 162's acceptance)", () => {
  const capsuleOf = (...items: TodoItem[]) => ({
    today: items,
    later: [LATER],
    anytime: [] as TodoItem[],
  });
  const body = () => button().querySelector<HTMLElement>("[data-capsule-body]");
  const leavingRow = () =>
    button().querySelector<HTMLElement>("[data-todo-capsule-leaving]");

  it("keeps its row where it was and its frame on the button for the glide as today's last goes, then drops them", async () => {
    setList(1, capsuleOf(today("a", 15)));
    mount();
    const rowText = body()!.textContent ?? "";
    setList(0, capsuleOf());
    expect(button().dataset.shape).toBe("icon");
    // The row it had, at the width it had, fading.
    const row = leavingRow();
    expect(row?.textContent).toBe(rowText);
    expect(row?.getAttribute("aria-hidden")).toBe("true");
    expect(row?.style.width).toBe(`${8 * rowText.length}px`);
    expect(played.find((p) => p.el === row)?.keyframes).toEqual({
      opacity: ["1", "0"],
    });
    // The frame on the button, following its width: from the hairline
    // and the round ends to the icon look's.
    const [glide] = widthGlides();
    expect(glide.keyframes.width).toEqual([
      `${28 + 4 + 8 + 4 + 8 * rowText.length}px`,
      "28px",
    ]);
    expect(glide.keyframes.borderColor).toEqual([LINE, NONE]);
    expect(glide.keyframes.borderRadius).toEqual(["14px", "6px"]);
    // Placed against the button while it glides.
    expect(button().style.position).toBe("relative");
    await act(async () => {
      glide.finish();
      await Promise.resolve();
    });
    expect(leavingRow()).toBeNull();
    expect(button().getAttribute("style") ?? "").toBe("");
    expect(widthGlides()).toHaveLength(1);
  });

  it("to the word: the word fades in where the row fades out", () => {
    setList(1, { today: [today("a", 15)], later: [], anytime: [] });
    mount();
    setList(0, { today: [], later: [], anytime: [] });
    expect(button().dataset.shape).toBe("word");
    expect(leavingRow()).not.toBeNull();
    const word = button().querySelector("[data-todo-word]");
    expect(played.find((p) => p.el === word)?.keyframes).toEqual({
      opacity: ["0", "1"],
    });
  });

  it("keeps no frame where the header was too narrow for the capsule (folded to the icon and N)", () => {
    narrow = true;
    setList(1, capsuleOf(today("a", 15)));
    mount();
    setList(0, capsuleOf());
    const [glide] = widthGlides();
    expect(glide.keyframes.borderColor).toBeUndefined();
    // The number that was drawn there leaves as before.
    expect(
      button().querySelector("[data-todo-count-leaving]")?.textContent,
    ).toBe("1");
  });

  it("the other way: the frame is there from the first frame and the row is laid out as it ends up, only cut", async () => {
    setList(0, capsuleOf());
    mount();
    setList(1, capsuleOf(today("a", 15)));
    // The capsule's classes in this commit: the hairline grows with the
    // width from the first frame, nothing animates it.
    expect(button().dataset.shape).toBe("capsule");
    expect(button().className).toContain("rounded-full");
    const [glide] = widthGlides();
    expect(glide.keyframes.borderColor).toBeUndefined();
    // Its row at the width it ends at: no ellipsis moving on the way.
    const rowText = body()!.textContent ?? "";
    expect(body()!.style.width).toBe(`${8 * rowText.length}px`);
    expect(body()!.style.flexShrink).toBe("0");
    await act(async () => {
      glide.finish();
      await Promise.resolve();
    });
    expect(body()!.getAttribute("style") ?? "").toBe("");
    expect(button().getAttribute("style") ?? "").toBe("");
  });

  it("a capsule to a capsule draws the next row at once, nothing left behind", () => {
    setList(2, capsuleOf(today("a", 15), today("b", 18)));
    mount();
    setList(1, capsuleOf(today("b", 18)));
    expect(leavingRow()).toBeNull();
    expect(body()!.textContent).toContain("事 b");
  });
});

describe("reduced motion", () => {
  it("puts the width where it ends up at once and drops the number that goes", () => {
    reduced = true;
    setList(2);
    mount();
    setList(3);
    // The number still ticks (the class only fades there, globals.css).
    expect(number()?.className).toContain("todo-count-tick");
    setList(0);
    expect(number()).toBeNull();
    expect(button().querySelector("[data-todo-count-leaving]")).toBeNull();
    expect(widthGlides()).toHaveLength(0);
    expect(button().getAttribute("style") ?? "").toBe("");
  });

  it("drops the capsule at once as today's last goes: no row left, no frame kept", () => {
    reduced = true;
    setList(1, { today: [today("a", 15)], later: [LATER], anytime: [] });
    mount();
    setList(0, { today: [], later: [LATER], anytime: [] });
    expect(button().dataset.shape).toBe("icon");
    expect(button().querySelector("[data-todo-capsule-leaving]")).toBeNull();
    expect(widthGlides()).toHaveLength(0);
    expect(button().getAttribute("style") ?? "").toBe("");
  });
});
