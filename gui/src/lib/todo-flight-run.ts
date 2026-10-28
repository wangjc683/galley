import type { FreshCard } from "@/lib/fresh-cards";
import {
  CATCH_POP_MS,
  CATCH_WASH_MS,
  FLIGHT_LEVEL,
  FLIGHT_START_PX,
  cardFlightPlan,
  catchDip,
  flightFrame,
  flightSchedule,
  type Point,
} from "@/lib/todo-flight";

/**
 * The DOM half of a card's glyph flying into the top bar's 「待办」
 * button (main chat ticket 102, PRD ruling 147 point 6; the rules and
 * the path are lib/todo-flight.ts's).
 *
 * - **Where from**: the card's glyph — the to-do's box, the reminder's
 *   alarm, the memo's notepad — the 16px column every card keeps it in
 *   (`data-card-icon`), measured as each glyph takes off. One scrolled
 *   out of the conversation's view (`data-conversation-backdrop`) or
 *   the window does not fly.
 * - **Where to**: the button's own glyph, `[data-role="topbar-todo"]`,
 *   measured as each takes off: the button changes width with what it
 *   shows (TodoToggleButton), so nothing about its place is written
 *   here.
 * - **The layer**: one fixed, full-window layer on <body>, inert and
 *   `pointer-events: none`, at z 40 — over the conversation and the top
 *   bar (z 10–30), under the dialogs and menus (z 50 up). A copy of the
 *   glyph flies in it, its colour the card's; the card's own glyph
 *   stays where it is.
 * - **The catch**: the button pops (`todo-catch-pop`, its peak and dip
 *   as custom properties), in full ink for the while — only its glyph
 *   while it stands as a capsule (`popTarget`, main chat ticket 104);
 *   under reduced motion its ground washes `bg-hover` and fades back
 *   (`todo-catch-wash`). The class is there for the animation's length,
 *   as a panel row takes the locate wash (useTodoPanelFlash).
 */

/** A glyph to fly: where it starts (measured at takeoff; null when it
 * is gone), a copy of it, and its colour. */
interface FlightSource {
  measure: () => Point | null;
  copy: () => HTMLElement;
  color: string;
}

const LAYER_ROLE = "todo-flight-layer";
const POP_CLASS = "todo-catch-pop";
const WASH_CLASS = "todo-catch-wash";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

function centre(box: DOMRect): Point {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** The top bar's 「待办」 button. */
function catcher(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-role="topbar-todo"]');
}

/** The centre of the button's glyph (its list icon), or of the button:
 * the glyph stays at the button's left whatever it shows. */
function catcherCentre(): Point | null {
  const button = catcher();
  if (!button) return null;
  const glyph = button.querySelector("svg") ?? button;
  return centre(glyph.getBoundingClientRect());
}

/** The card a fresh card is drawn as, and its glyph's column. */
function cardGlyph(card: FreshCard): HTMLElement | null {
  const [role, key] =
    card.kind === "todo"
      ? ["todo-card", "todoId"]
      : card.kind === "reminder"
        ? ["reminder-card", "reminderId"]
        : ["memo-card", "memoEvent"];
  const found = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-role="${role}"]`),
  ).find((el) => el.dataset[key] === card.card);
  return found?.querySelector<HTMLElement>("[data-card-icon]") ?? null;
}

/** Whether a glyph's centre is inside the conversation's view and the
 * window: not scrolled out. */
function glyphInView(glyph: HTMLElement): boolean {
  const box = glyph.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return false;
  const { x, y } = centre(box);
  const scroller = glyph.closest<HTMLElement>("[data-conversation-backdrop]");
  const view = scroller?.getBoundingClientRect();
  const top = Math.max(view?.top ?? 0, 0);
  const bottom = Math.min(
    view?.bottom ?? window.innerHeight,
    window.innerHeight,
  );
  const left = Math.max(view?.left ?? 0, 0);
  const right = Math.min(view?.right ?? window.innerWidth, window.innerWidth);
  return x >= left && x <= right && y >= top && y <= bottom;
}

/** A copy of a card's glyph column, inert, without the ids and data the
 * real one is found by. */
function copyOf(glyph: HTMLElement): HTMLElement {
  const copy = glyph.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
    el.removeAttribute("id");
    for (const name of el.getAttributeNames()) {
      if (name.startsWith("data-")) el.removeAttribute(name);
    }
  }
  return copy;
}

function glyphSource(glyph: HTMLElement): FlightSource {
  return {
    measure: () =>
      glyph.isConnected ? centre(glyph.getBoundingClientRect()) : null,
    copy: () => copyOf(glyph),
    color: getComputedStyle(glyph).color,
  };
}

function layer(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-role="${LAYER_ROLE}"]`,
  );
  if (found) return found;
  const el = document.createElement("div");
  el.dataset.role = LAYER_ROLE;
  el.setAttribute("aria-hidden", "true");
  el.inert = true;
  Object.assign(el.style, {
    position: "fixed",
    inset: "0",
    zIndex: "40",
    pointerEvents: "none",
    overflow: "hidden",
  });
  document.body.appendChild(el);
  return el;
}

/** One glyph's flight, from its source to the button, frame by frame. */
function fly(source: FlightSource): void {
  const level = FLIGHT_LEVEL;
  const from = source.measure();
  const to = catcherCentre();
  if (!from || !to) return;
  const host = layer();
  const node = document.createElement("div");
  node.dataset.role = "todo-flight";
  Object.assign(node.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: `${FLIGHT_START_PX}px`,
    height: `${FLIGHT_START_PX}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transformOrigin: "center",
    willChange: "transform, opacity",
    color: source.color,
  });
  node.appendChild(source.copy());
  host.appendChild(node);
  const place = (elapsed: number) => {
    const frame = flightFrame(from, to, level, elapsed);
    const half = FLIGHT_START_PX / 2;
    node.style.transform = `translate(${frame.x - half}px, ${frame.y - half}px) scale(${frame.size / FLIGHT_START_PX})`;
    node.style.opacity = String(frame.opacity);
  };
  place(0);
  const start = performance.now();
  const step = (now: number) => {
    const elapsed = now - start;
    if (elapsed >= level.durationMs) {
      node.remove();
      if (host.childElementCount === 0) host.remove();
      return;
    }
    place(elapsed);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * What the pop scales (main chat ticket 104, PRD ruling 150 point 6):
 * the whole button, or only its glyph while the button stands as a
 * capsule (`data-shape="capsule"`, its body drawn): 1.15 on a 200px
 * capsule would swing its ends out about 15px. A narrow header folds
 * the capsule to the icon and today's count (TodoToggleButton), the
 * body no longer drawn: the whole button again, as the icon look's and
 * the word's (main chat ticket 106, PRD ruling 152).
 */
function popTarget(button: HTMLElement): HTMLElement | SVGElement {
  if (button.dataset.shape !== "capsule") return button;
  const body = button.querySelector("[data-capsule-body]");
  if (!body || body.getClientRects().length === 0) return button;
  return button.querySelector("svg") ?? button;
}

let catchTimer: ReturnType<typeof setTimeout> | null = null;
let caught: HTMLElement | SVGElement | null = null;

/** The button catches: a pop at `FLIGHT_LEVEL`'s scale, or under
 * reduced motion a wash of its ground. Again while one runs: it starts
 * over. */
function catchOn(kind: "pop" | "wash"): void {
  const button = catcher();
  if (!button) return;
  const target = kind === "pop" ? popTarget(button) : button;
  const cls = kind === "pop" ? POP_CLASS : WASH_CLASS;
  caught?.classList.remove(POP_CLASS, WASH_CLASS);
  button.classList.remove(POP_CLASS, WASH_CLASS);
  if (catchTimer !== null) clearTimeout(catchTimer);
  void button.offsetWidth;
  if (kind === "pop") {
    const { popScale } = FLIGHT_LEVEL;
    target.style.setProperty("--todo-catch-peak", String(popScale));
    target.style.setProperty("--todo-catch-dip", String(catchDip(popScale)));
  }
  target.classList.add(cls);
  caught = target;
  catchTimer = setTimeout(
    () => {
      catchTimer = null;
      caught = null;
      target.classList.remove(cls);
    },
    kind === "pop" ? CATCH_POP_MS : CATCH_WASH_MS,
  );
}

/** Fly `sources` one after another, the button popping as the last
 * lands; with none, it pops at once. */
function flyAll(sources: readonly FlightSource[]): void {
  const { starts, popAt } = flightSchedule(sources.length, FLIGHT_LEVEL);
  sources.forEach((source, i) => {
    if (starts[i] === 0) fly(source);
    else setTimeout(() => fly(source), starts[i]);
  });
  if (popAt === 0) catchOn("pop");
  else setTimeout(() => catchOn("pop"), popAt);
}

/** What `flyFreshCards` is told: the new cards and how things stand. */
export interface FreshCardFlight {
  fresh: readonly FreshCard[];
  mainChatOnScreen: boolean;
  panelShown: boolean;
}

/**
 * The new cards under a reply, flown into the button, or only a pop, or
 * nothing (`cardFlightPlan`): hooks/useFreshCards.ts, once a round's
 * cards are gathered and the panel did not open by itself.
 */
export function flyFreshCards(input: FreshCardFlight): void {
  if (typeof document === "undefined") return;
  const glyphs = new Map(
    input.fresh.map((card) => [`${card.kind}:${card.card}`, cardGlyph(card)]),
  );
  const glyphOf = (card: FreshCard) => glyphs.get(`${card.kind}:${card.card}`);
  const plan = cardFlightPlan({
    ...input,
    reducedMotion: prefersReducedMotion(),
    inView: (card) => {
      const glyph = glyphOf(card);
      return !!glyph && glyphInView(glyph);
    },
  });
  if (!plan) return;
  if (plan.catch === "wash") {
    catchOn("wash");
    return;
  }
  flyAll(plan.fly.map((card) => glyphSource(glyphOf(card)!)));
}
