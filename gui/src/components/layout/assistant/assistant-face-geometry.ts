import iconSvg from "@/assets/galley-icon.svg?raw";

/**
 * The app icon taken apart for the face that moves (main chat ticket
 * 65). The drawing is not redrawn: its own pieces are read from the
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
 * hole outlines, and a strip of wood that comes down over the mouth.
 *
 * Measured on the master rendered at one pixel per unit (inside its
 * `translate(-4 122)` group): the head's inside walls at x 1696 and
 * 3377, its top at y 1694; the eyes at y 1773–2026; the mouth from x
 * 2035 to 2961, its top at y 2104, open down to the lower lip at y 2607.
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

/** How far a plug reaches past a hole's edge (its stroke is twice
 * this): about one device pixel at 28px on a 2x display (73 units),
 * short of the head's top wall (79 units above the eyes). */
export const PLUG_RIM = 64;

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

/** The avatar's centre, the origin the figure tilts and scales about:
 * turning about it, the figure never leaves the circle it is cropped
 * to. In the viewBox, outside the figure group. */
export const FIGURE_ORIGIN = { x: 2048, y: 2048 } as const;
