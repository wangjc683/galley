import iconSvg from "@/assets/galley-icon.svg?raw";

/**
 * The app icon taken apart for the face that moves (main chat tickets
 * 65, 66). The drawing is not redrawn: its own pieces are read from the
 * vector master (`gui/src/assets/galley-icon.svg`, byte for byte
 * `core/icons/master/galley-icon.svg`) — the pale ground, the dark
 * silhouette, the wood laid over it — and drawn exactly as the file
 * draws them, so the face at rest is the icon, pixel for pixel.
 *
 * The eyes and the mouth are where the wood is open over the dark: the
 * wood's two round holes are the eyes (its third and fourth subpaths),
 * and its outline leaves the mouth open down to the lower lip. To move
 * them, the avatar lays over the drawing — only while they move — wood
 * plugs over the holes (traced from the holes themselves, with an edge
 * that covers their anti-aliased rim), dark eyes cut from the same
 * hole outlines, a strip of wood that comes down over the mouth and a
 * dark one that opens it further down.
 *
 * The tongue — the long one curling into the G — bends on a skeleton of
 * three joints (`TONGUE`): the two traced paths themselves are bent, each
 * of their points carried along the tongue's centre line as it turns
 * (`TongueSkin`), so a joint has no seam to hide; the head and the root
 * of the tongue under it stay as drawn.
 *
 * Measured on the master rendered at one pixel per unit (inside its
 * `translate(-4 122)` group): the head's inside walls at x 1696 and
 * 3377, its top at y 1694, its outer edges at x 1586 and 3476 and y 1588;
 * the eyes at y 1773–2026; the mouth from x 2035 to 2961, its top at y
 * 2104, open down to the lower lip at y 2607 and to the wood under it at
 * y 2688; that wood runs down to the G's outer edge at y 3218. The G is
 * near enough a ring about (2052, 1926): its outer edge at radius 1428,
 * the hole's at 640.
 */

interface IconPath {
  d: string;
  fill: string;
  fillRule: "evenodd" | "nonzero";
}

export interface IconParts {
  viewBox: string;
  /** The square's ground colour. */
  ground: string;
  /** The figure group's transform. */
  transform: string;
  /** The dark silhouette. */
  outline: IconPath;
  /** The wood over it, with the eyes' holes in it. */
  wood: IconPath;
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  if (!m) throw new Error(`galley-icon.svg: no ${name} in ${tag.slice(0, 40)}`);
  return m[1];
}

/** Read the master's pieces. It is one ground rect and one group of two
 * paths; a test pins the shape, so a new master that differs fails
 * loudly rather than drawing something else. */
export function parseIcon(svg: string): IconParts {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const rect = /<rect\b[^>]*>/.exec(svg)?.[0] ?? "";
  const group = /<g\b[^>]*>/.exec(svg)?.[0] ?? "";
  const paths = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
  if (paths.length !== 2) {
    throw new Error(`galley-icon.svg: expected 2 paths, found ${paths.length}`);
  }
  const path = (tag: string): IconPath => ({
    d: attr(tag, "d"),
    fill: attr(tag, "fill"),
    fillRule: attr(tag, "fill-rule") === "evenodd" ? "evenodd" : "nonzero",
  });
  return {
    viewBox: attr(root, "viewBox"),
    ground: attr(rect, "fill"),
    transform: attr(group, "transform"),
    outline: path(paths[0]),
    wood: path(paths[1]),
  };
}

export const ICON = parseIcon(iconSvg);

/** A closed subpath and its bounding box. */
export interface Subpath {
  d: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function subpaths(d: string): Subpath[] {
  return d
    .split(/(?=M)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const nums = (part.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      return {
        d: part,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
    });
}

export interface Eye {
  /** The hole's outline: the eye as drawn. */
  d: string;
  /** Its centre, the origin it opens, closes and widens about. */
  cx: number;
  cy: number;
}

/** The wood's round holes, left eye first: the subpaths 200–350 units
 * across (the body is thousands, a sliver inside it a few). */
export const EYES: Eye[] = subpaths(ICON.wood.d)
  .filter((p) => {
    const w = p.maxX - p.minX;
    const h = p.maxY - p.minY;
    return w > 200 && w < 350 && h > 200 && h < 350;
  })
  .sort((a, b) => a.minX - b.minX)
  .map((p) => ({
    d: p.d,
    cx: (p.minX + p.maxX) / 2,
    cy: (p.minY + p.maxY) / 2,
  }));

/** An eye's radius as drawn (both are about 270 across). */
export const EYE_RADIUS = 135;

/** How far a plug reaches past a hole's edge (its stroke is twice
 * this): about one device pixel at 28px on a 2x display (73 units),
 * short of the head's top wall (79 units above the eyes). */
export const PLUG_RIM = 64;

/**
 * Where the eyes may go inside the face (ticket 66): the head's inside
 * walls and top, and the mouth's top, less a margin so an eye never
 * touches them at its drawn size. A wider eye has less room; past it
 * the eye overlaps the dark of the wall or the mouth and reads as
 * bulging out of the head (the widest, `MAX_WIDE`, does by about half a
 * pixel on the 72px avatar).
 */
export const FACE_ROOM = {
  left: 1696,
  right: 3377,
  top: 1694,
  /** The mouth's top. */
  bottom: 2104,
  margin: 16,
  /** Two eyes never closer than this, edge to edge. */
  between: 80,
} as const;

/** The widest an eye opens: about 1.7 times as drawn (ruling 119 asks
 * for about 1.8; past 1.7 the eye spills into the head's top wall). */
export const MAX_WIDE = 1.7;

/**
 * The strip of wood that closes the mouth from the top. It spans past
 * the mouth on both sides (wood there), from just under the eyes; at
 * rest its foot is the mouth's top edge, and it comes down to the lower
 * lip as the mouth closes (`lipScale`).
 */
export const LIP = {
  x: 1990,
  width: 1016,
  top: 2034,
  /** The mouth's top edge: the strip's foot with the mouth as drawn. */
  restBottom: 2104,
  /** Just over the lower lip: the mouth shut. */
  shutBottom: 2600,
} as const;

/** The strip's scaleY (from its top) for a mouth `jaw` closed (0 as
 * drawn, 1 shut). */
export function lipScale(jaw: number): number {
  const height = LIP.shutBottom - LIP.top;
  const bottom = LIP.restBottom + jaw * (LIP.shutBottom - LIP.restBottom);
  return (bottom - LIP.top) / height;
}

/**
 * The mouth opened past its drawing (ticket 66: up to about twice): a
 * dark strip the mouth's width hanging from its lower lip, over the
 * wood under the mouth, its foot coming down as the mouth opens and
 * rounded like the mouth's own lower corner. The wood under the mouth
 * runs down to y 3218; `MAX_MOUTH` leaves a band of it.
 */
export const JAW = {
  x: 2035,
  width: 926,
  /** Its top, inside the dark of the lower lip (2607–2688). */
  top: 2620,
  /** The mouth's foot as drawn: the strip's foot at `mouth` 1. */
  restBottom: 2688,
  /** The mouth's height as drawn (2104 to 2688). */
  height: 584,
  corner: 70,
} as const;

/** How far the mouth opens: 1.8 times as drawn leaves about a pixel of
 * wood under it on the 72px avatar. */
export const MAX_MOUTH = 1.8;

/** The jaw strip's full height (at `MAX_MOUTH`). */
export const JAW_FULL = JAW.restBottom + (MAX_MOUTH - 1) * JAW.height - JAW.top;

/** The jaw strip's scaleY (from its top) for a mouth `mouth` open (1 as
 * drawn: its foot on the mouth's own). */
export function jawScale(mouth: number): number {
  const open = Math.min(MAX_MOUTH, Math.max(1, mouth));
  return (JAW.restBottom + (open - 1) * JAW.height - JAW.top) / JAW_FULL;
}

/** A small round mouth, o, in the middle of the shut one. */
export const MOUTH_O = { cx: 2498, cy: 2330, rx: 150, ry: 175 } as const;

/** A grin: the mouth shut, a wide D under the eyes, flat on top. */
export const GRIN_PATH =
  "M2010 2170L2986 2170C2986 2520 2800 2700 2498 2700C2196 2700 2010 2520 2010 2170Z";

/** The smiling eyes, ^ ^: a soft arch over each eye's centre, stroked in
 * the outline's dark with round ends. */
export function smilePath(eye: Eye): string {
  const { cx, cy } = eye;
  return `M${cx - 115} ${cy + 40}Q${cx} ${cy - 120} ${cx + 115} ${cy + 40}`;
}
export const SMILE_STROKE = 80;

/** The sleeping eyes, ‿ ‿: a soft dip through each eye's centre. */
export function sleepPath(eye: Eye): string {
  const { cx, cy } = eye;
  return `M${cx - 110} ${cy - 10}Q${cx} ${cy + 90} ${cx + 110} ${cy - 10}`;
}
export const SLEEP_STROKE = 70;

/** Eyes squeezed with effort, > <: each a chevron pointing at the
 * other eye. */
export function strainPath(eye: Eye, index: number): string {
  const { cx, cy } = eye;
  const s = index === 0 ? 1 : -1;
  return `M${cx - s * 95} ${cy - 105}L${cx + s * 85} ${cy}L${cx - s * 95} ${cy + 105}`;
}
export const STRAIN_STROKE = 78;

/** Eyes knocked out, × ×: two strokes across each. */
export function crossPath(eye: Eye): string {
  const { cx, cy } = eye;
  const r = 100;
  return `M${cx - r} ${cy - r}L${cx + r} ${cy + r}M${cx + r} ${cy - r}L${cx - r} ${cy + r}`;
}
export const CROSS_STROKE = 78;

/** The avatar's centre, in the view box: the figure turns about a point
 * a little under it (the middle of the head and the G together). */
export const FIGURE_ORIGIN = { x: 2048, y: 2200 } as const;
/** Where the figure squashes and stretches from: the middle of its
 * foot, the G's lowest edge (3348 in the group, 3470 in the view box),
 * so it lands on the ground it stood on. */
export const FIGURE_FOOT = { x: 2048, y: 3470 } as const;

// ---- The tongue's skeleton ----------------------------------------------

/**
 * The tongue as a body (ticket 66). From the head's lower right it runs
 * down, along the bottom, up the left side, over the top and ends in
 * the cut tip at the upper right: near enough a ring about `centre`,
 * angles in degrees clockwise from the right (screen y runs down), so
 * the bottom is at 90°, the left at 180°, the top at 270° and the tip
 * ends near 335°.
 *
 * Three joints on its centre line cut it into four: the root (from the
 * head to 165°, fixed to the head), the left side (165–220°), the top
 * (220–280°) and the tip (280° on). Each joint bends the tongue over
 * `zone` degrees either side of it, eased, so the bend is a curve and
 * not a corner; `stretch` lengthens everything past the first joint.
 *
 * What is head and what is tongue: every point of the two paths right
 * of x 1555 and under y 1565 is the head or the root under it (the
 * tongue's band starts left of the head's outer wall at 1586, and its
 * tip ends above the head's top at 1588), so it stays put; so does any
 * point before `from`.
 */
export const TONGUE = {
  centre: { x: 2052, y: 1926 },
  /** The centre line's radius (the band runs 640–1428). */
  radius: 1035,
  joints: [165, 220, 280] as const,
  zone: 24,
  from: 120,
  to: 350,
  head: { minX: 1555, minY: 1565 },
} as const;

/** A tongue's bend: each joint's angle (degrees, clockwise: positive
 * curls it tighter toward the head, negative opens it out) and how much
 * longer it gets past the first joint (0: as drawn, 0.15: 15% longer). */
export interface TonguePose {
  t1: number;
  t2: number;
  t3: number;
  stretch: number;
}

export const TONGUE_REST: TonguePose = { t1: 0, t2: 0, t3: 0, stretch: 0 };

export function tongueAtRest(p: TonguePose): boolean {
  return p.t1 === 0 && p.t2 === 0 && p.t3 === 0 && p.stretch === 0;
}

const RAD = Math.PI / 180;
const STEP = 0.5;
const smoothstep = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

/** How far each joint has turned at angle `a` (its bend eased over its
 * zone), and how much longer the tongue is there. */
function bendAt(p: TonguePose, a: number): { turn: number; grow: number } {
  const { joints, zone } = TONGUE;
  const k = (j: number) => smoothstep((a - (joints[j] - zone)) / (2 * zone));
  return {
    turn: p.t1 * k(0) + p.t2 * k(1) + p.t3 * k(2),
    grow: p.stretch * k(0),
  };
}

/** The bent centre line, every half degree from `from` to `to`: its
 * point and how far its direction has turned. Stepping along chords
 * keeps it exactly on the ring where nothing bends. */
interface CentreLine {
  x: Float64Array;
  y: Float64Array;
  turn: Float64Array;
}

function centreLine(p: TonguePose): CentreLine {
  const { centre, radius, from, to } = TONGUE;
  const n = Math.round((to - from) / STEP) + 1;
  const line = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    turn: new Float64Array(n),
  };
  let x = centre.x + radius * Math.cos(from * RAD);
  let y = centre.y + radius * Math.sin(from * RAD);
  const chord = 2 * radius * Math.sin((STEP * RAD) / 2);
  for (let i = 0; i < n; i++) {
    const a = from + i * STEP;
    line.x[i] = x;
    line.y[i] = y;
    line.turn[i] = bendAt(p, a).turn;
    const mid = a + STEP / 2;
    const { turn, grow } = bendAt(p, mid);
    const dir = (mid + turn) * RAD;
    x += -Math.sin(dir) * chord * (1 + grow);
    y += Math.cos(dir) * chord * (1 + grow);
  }
  return line;
}

/** A point of a path: where it is around the ring, or fixed. */
interface SkinPoint {
  x: number;
  y: number;
  /** Its angle around the ring, or null for the head and the root. */
  a: number | null;
  /** Its offset from the centre line, outward. */
  off: number;
}

function skinPoint(x: number, y: number): SkinPoint {
  const { centre, radius, from, head } = TONGUE;
  if (x >= head.minX && y >= head.minY) return { x, y, a: null, off: 0 };
  let a = Math.atan2(y - centre.y, x - centre.x) / RAD;
  if (a < 60) a += 360;
  if (a <= from) return { x, y, a: null, off: 0 };
  return { x, y, a, off: Math.hypot(x - centre.x, y - centre.y) - radius };
}

function bend(line: CentreLine, q: SkinPoint): [number, number] {
  if (q.a === null) return [q.x, q.y];
  const f = Math.min(line.x.length - 1.000001, (q.a - TONGUE.from) / STEP);
  const i = Math.floor(f);
  const t = f - i;
  const cx = line.x[i] + (line.x[i + 1] - line.x[i]) * t;
  const cy = line.y[i] + (line.y[i + 1] - line.y[i]) * t;
  const turn = line.turn[i] + (line.turn[i + 1] - line.turn[i]) * t;
  const n = (q.a + turn) * RAD;
  return [cx + q.off * Math.cos(n), cy + q.off * Math.sin(n)];
}

/**
 * One of the icon's paths, ready to bend: its numbers in x, y pairs and
 * the text between them (the master writes only `M`, `C` and `Z` with
 * absolute coordinates). `at(pose)` is the path with the tongue bent,
 * its numbers to a tenth of a unit as the master writes them; at rest
 * it is the master's own text.
 */
export class TongueSkin {
  private readonly between: string[];
  private readonly points: SkinPoint[];
  /** Bends already made: a beat's keys come back to the same few. */
  private readonly made = new Map<string, string>();

  constructor(private readonly d: string) {
    const between: string[] = [];
    const points: SkinPoint[] = [];
    const re = /(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/g;
    let last = 0;
    for (const m of d.matchAll(re)) {
      between.push(d.slice(last, m.index));
      points.push(skinPoint(Number(m[1]), Number(m[2])));
      last = m.index + m[0].length;
    }
    between.push(d.slice(last));
    this.between = between;
    this.points = points;
  }

  at(p: TonguePose): string {
    if (tongueAtRest(p)) return this.d;
    const key = tongueKey(p);
    const made = this.made.get(key);
    if (made !== undefined) return made;
    const line = centreLine(p);
    let out = this.between[0];
    this.points.forEach((q, i) => {
      const [x, y] = bend(line, q);
      out += `${fmt(x)} ${fmt(y)}${this.between[i + 1]}`;
    });
    if (this.made.size >= 256) {
      this.made.delete(this.made.keys().next().value as string);
    }
    this.made.set(key, out);
    return out;
  }

  /** The tongue's own points (not the head's) with the tongue bent. */
  tonguePoints(p: TonguePose): [number, number][] {
    const line = centreLine(p);
    return this.points.filter((q) => q.a !== null).map((q) => bend(line, q));
  }
}

function tongueKey(p: TonguePose): string {
  return `${p.t1.toFixed(2)} ${p.t2.toFixed(2)} ${p.t3.toFixed(2)} ${p.stretch.toFixed(4)}`;
}

function fmt(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1);
}

export const OUTLINE_SKIN = new TongueSkin(ICON.outline.d);
export const WOOD_SKIN = new TongueSkin(ICON.wood.d);

/**
 * Whether a bend keeps the tongue off the head: none of its points
 * (past the first joint's bend, where it has moved) within `margin` of
 * the head's outer box (x 1586–3476, from y 1588 down). Curling in, the
 * tip comes down on the head's top and the left side onto its side
 * wall; the two would merge into one shape where they meet.
 */
export function tongueClearOfHead(p: TonguePose, margin = 24): boolean {
  if (tongueAtRest(p)) return true;
  const minX = 1586 - margin;
  const maxX = 3476 + margin;
  const minY = 1588 - margin;
  const startA = TONGUE.joints[0] - TONGUE.zone;
  const line = centreLine(p);
  for (const q of OUTLINE_POINTS) {
    if (q.a === null || q.a <= startA) continue;
    const [x, y] = bend(line, q);
    if (x >= minX && x <= maxX && y >= minY) return false;
  }
  return true;
}

const OUTLINE_POINTS: SkinPoint[] = (() => {
  const out: SkinPoint[] = [];
  for (const m of ICON.outline.d.matchAll(
    /(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/g,
  )) {
    out.push(skinPoint(Number(m[1]), Number(m[2])));
  }
  return out;
})();

/**
 * A bend kept off the head: the parts that curl it in (positive angles)
 * eased back, halving the gap, until it is clear. What opens it out is
 * kept whole.
 */
export function clearTongue(p: TonguePose): TonguePose {
  if (p.t1 <= 0 && p.t2 <= 0 && p.t3 <= 0) return p;
  const key = tongueKey(p);
  const known = CLEARED.get(key);
  if (known) return known;
  const cleared = clearTongueNow(p);
  if (CLEARED.size >= 256) {
    CLEARED.delete(CLEARED.keys().next().value as string);
  }
  CLEARED.set(key, cleared);
  return cleared;
}

const CLEARED = new Map<string, TonguePose>();

function clearTongueNow(p: TonguePose): TonguePose {
  if (tongueClearOfHead(p)) return p;
  const curl = (k: number): TonguePose => ({
    t1: p.t1 > 0 ? p.t1 * k : p.t1,
    t2: p.t2 > 0 ? p.t2 * k : p.t2,
    t3: p.t3 > 0 ? p.t3 * k : p.t3,
    stretch: p.stretch,
  });
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (tongueClearOfHead(curl(mid))) lo = mid;
    else hi = mid;
  }
  return curl(lo);
}

// ---- The marks -----------------------------------------------------------

/**
 * The comic marks over its head (ticket 66, ruling 119): ？ thinking or
 * asking, ！ woken or startled, z z dozing, ✦ done, a drop of sweat on
 * an error. One at a time, about 12px tall on the 72px avatar (680
 * units), drawn just outside the avatar's circle at its upper left, in
 * the view box (outside the figure's group): the corner badge (unread,
 * a question, an error) has the upper right. Glyphs are drawn about
 * their own centre; `MARK_ANCHOR` places them.
 */
export const MARK_ANCHOR = { x: -150, y: 600 } as const;

export type MarkKind = "q" | "bang" | "zz" | "spark" | "sweat";

export const MARK_STROKE = 110;

export const MARK_GLYPHS: Record<
  MarkKind,
  {
    stroke?: string;
    fill?: string;
    dot?: { cx: number; cy: number; r: number };
  }
> = {
  q: {
    stroke: "M-175 -150C-175 -330 175 -330 175 -150C175 -40 10 -40 10 90",
    dot: { cx: 10, cy: 270, r: 72 },
  },
  bang: {
    stroke: "M0 -320L0 100",
    dot: { cx: 0, cy: 270, r: 72 },
  },
  zz: {
    stroke:
      "M-260 -40L-20 -40L-260 230L-20 230M60 -330L230 -330L60 -140L230 -140",
  },
  spark: {
    fill: "M0 -340C40 -60 60 -40 340 0C60 40 40 60 0 340C-40 60 -60 40 -340 0C-60 -40 -40 -60 0 -340Z",
  },
  sweat: {
    fill: "M0 -300C70 -160 200 -20 200 110C200 225 110 300 0 300C-110 300 -200 225 -200 110C-200 -20 -70 -160 0 -300Z",
  },
};
