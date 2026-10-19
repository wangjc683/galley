import { type ReactNode, useEffect, useId, useRef } from "react";

import type { FaceBeat, FacePose } from "@/lib/assistant-face-motion";
import { useAssistantFaceStore } from "@/stores/assistant-face";

import {
  CROSS_STROKE,
  crossPath,
  EYES,
  FIGURE_FOOT,
  GRIN_PATH,
  ICON,
  JAW,
  JAW_FULL,
  LIP,
  MARK_ANCHOR,
  MARK_GLYPHS,
  MARK_STROKE,
  type MarkKind,
  MOUTH_O,
  PLUG_RIM,
  SLEEP_STROKE,
  sleepPath,
  SMILE_STROKE,
  smilePath,
  STRAIN_STROKE,
  strainPath,
} from "./assistant-face-geometry";
import {
  BOB_PART,
  displayPose,
  FACE_PARTS,
  type FacePart,
  partAnimation,
  partAttribute,
  partValue,
  REST_VALUE,
} from "./face-smil";

const SVG_NS = "http://www.w3.org/2000/svg";
/** The strip over the mouth scales from the middle of its top; so does
 * the dark under it. */
const LIP_ORIGIN_X = LIP.x + LIP.width / 2;
const JAW_ORIGIN_X = JAW.x + JAW.width / 2;
/** Parts whose markup carries their rest value (the others carry none). */
const MARKUP_REST: Partial<Record<FacePart, string>> = {
  outline: REST_VALUE.outline,
  wood: REST_VALUE.wood,
  smile: REST_VALUE.smile,
  sleepy: REST_VALUE.sleepy,
  strain: REST_VALUE.strain,
  cross: REST_VALUE.cross,
  lip: REST_VALUE.lip,
  jaw: REST_VALUE.jaw,
  mouthO: REST_VALUE.mouthO,
  grin: REST_VALUE.grin,
  overlay: REST_VALUE.overlay,
  markQ: REST_VALUE.markQ,
  markBang: REST_VALUE.markBang,
  markZz: REST_VALUE.markZz,
  markSpark: REST_VALUE.markSpark,
  markSweat: REST_VALUE.markSweat,
};

type Parts = Partial<Record<FacePart, SVGElement>>;

/** The moving parts, found by their `data-face` names. */
function findParts(svg: SVGSVGElement): Parts {
  const parts: Parts = {};
  for (const part of FACE_PARTS) {
    const el = svg.querySelector<SVGElement>(`[data-face="${part}"]`);
    if (el) parts[part] = el;
  }
  return parts;
}

/** Hold a part at a pose between beats: its attribute, or the bare
 * markup when the pose is the drawing's. */
function holdPart(part: FacePart, el: SVGElement, pose: FacePose): void {
  const value = partValue(part, displayPose(pose));
  const { name } = partAttribute(part, value);
  if (value === REST_VALUE[part]) {
    const markup = MARKUP_REST[part];
    if (markup === undefined) el.removeAttribute(name);
    else el.setAttribute(name, partAttribute(part, markup).value);
    return;
  }
  el.setAttribute(name, partAttribute(part, value).value);
}

/** Drop a part's animations (the held attribute shows again). */
function dropAnimations(el: SVGElement): void {
  for (const child of [...el.children]) {
    if (
      child.localName === "animate" ||
      child.localName === "animateTransform"
    ) {
      child.remove();
    }
  }
}

function holdPose(parts: Parts, pose: FacePose): void {
  for (const part of FACE_PARTS) {
    const el = parts[part];
    if (!el) continue;
    holdPart(part, el, pose);
    dropAnimations(el);
  }
}

/**
 * Play a beat: each part starts held at the beat's first pose, and gets
 * one animation if it moves in it; all begin together. When they end,
 * each part is held at the last pose and its animation removed — back
 * to the bare markup when that pose is the drawing.
 */
function playBeat(svg: SVGSVGElement, parts: Parts, beat: FaceBeat): void {
  const started: SVGAnimationElement[] = [];
  for (const part of FACE_PARTS) {
    const el = parts[part];
    if (!el) continue;
    holdPart(part, el, beat.from);
    dropAnimations(el);
    const spec = beat.duration > 0 ? partAnimation(part, beat) : null;
    if (!spec) {
      holdPart(part, el, beat.end);
      continue;
    }
    const animation = document.createElementNS(SVG_NS, spec.element);
    for (const [name, value] of Object.entries(spec.attributes)) {
      animation.setAttribute(name, value);
    }
    el.appendChild(animation);
    started.push(animation as SVGAnimationElement);
  }
  // No SMIL (a test's DOM): set the end.
  if (started.some((a) => typeof a.beginElement !== "function")) {
    holdPose(parts, beat.end);
    return;
  }
  const settle = () => {
    // Only if this beat is still the one playing.
    if (!started[0]?.isConnected) return;
    holdPose(parts, beat.end);
  };
  started[0]?.addEventListener("endEvent", settle, { once: true });
  for (const a of started) a.beginElement();
  // The harness seeks frames from when the beat began.
  (svg as SVGSVGElement & { __beatBegan?: number }).__beatBegan =
    svg.getCurrentTime();
}

/** Play a breath of the undercurrent on its group: `move`'s animation,
 * on the group under it. */
function playBob(bob: SVGGElement, beat: FaceBeat): void {
  dropAnimations(bob);
  const hold = (pose: FacePose) => {
    const value = partValue("move", displayPose(pose));
    if (value === REST_VALUE.move) bob.removeAttribute("transform");
    else bob.setAttribute("transform", partAttribute("move", value).value);
  };
  const spec = beat.duration > 0 ? partAnimation("move", beat) : null;
  if (!spec) {
    hold(beat.end);
    return;
  }
  hold(beat.from);
  const animation = document.createElementNS(SVG_NS, spec.element);
  for (const [name, value] of Object.entries(spec.attributes)) {
    animation.setAttribute(name, value);
  }
  bob.appendChild(animation);
  const smil = animation as SVGAnimationElement;
  if (typeof smil.beginElement !== "function") {
    dropAnimations(bob);
    hold(beat.end);
    return;
  }
  smil.addEventListener(
    "endEvent",
    () => {
      if (!smil.isConnected) return;
      hold(beat.end);
      dropAnimations(bob);
    },
    { once: true },
  );
  smil.beginElement();
}

/** The marks' tones: the theme's ink, the brand's for ✦, the info blue
 * for sweat (red is for the error's words and badge). */
const MARK_TONE: Record<MarkKind, string> = {
  q: "text-ink-soft",
  bang: "text-ink-soft",
  zz: "text-ink-muted",
  spark: "text-brand-strong",
  sweat: "text-info",
};
const MARK_PART: Record<MarkKind, FacePart> = {
  q: "markQ",
  bang: "markBang",
  zz: "markZz",
  spark: "markSpark",
  sweat: "markSweat",
};

/**
 * The assistant's avatar as a face that moves (main chat tickets 65, 66;
 * PRD rulings 117, 119): the app icon drawn inline from its own vector
 * master (assistant-face-geometry.ts), so at rest it is the icon pixel
 * for pixel, with its eyes, mouth and tongue able to move. It plays the
 * beats the face director writes to the shared store; one mounted later
 * takes the pose the face holds.
 *
 * Two layers: the pale ground, cropped to the avatar's circle, and the
 * figure over it, not cropped (`overflow: visible`), so the figure can
 * jump out of its circle and the comic marks sit beside it. At rest the
 * figure lies inside the circle, so the two layers draw the cropped icon.
 *
 * The figure's parts are nested groups, one kind of transform each, so
 * that the head rises and falls under everything while it works (`bob`,
 * its own channel), the figure moves (`move`), tilts (`turn`) and
 * squashes from its foot (`squash`) as one; the tongue's two traced
 * paths bend; each eye opens about its own centre; the strips over the
 * mouth come down from its top and open it from its foot.
 *
 * Its sizes are final at 1× (ruling 119 point 7). `children` go between the ground and the figure (the avatar's ring:
 * the figure passes over it when it leaves the circle).
 *
 * It tells the store whether it is on screen (the director starts
 * nothing while none is). Decoration: hidden from screen readers.
 */
export function AssistantFace({ children }: { children?: ReactNode }) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const parts = findParts(svg);
    const bob = svg.querySelector<SVGGElement>(`[data-face="${BOB_PART}"]`);
    holdPose(parts, useAssistantFaceStore.getState().pose);
    return useAssistantFaceStore.subscribe((state, previous) => {
      if (state.seq !== previous.seq && state.beat) {
        playBeat(svg, parts, state.beat);
      }
      if (bob && state.bobSeq !== previous.bobSeq && state.bob) {
        playBob(bob, state.bob);
      }
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    const store = useAssistantFaceStore.getState();
    if (!svg || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        store.setOnScreen(id, entry.isIntersecting);
      }
    });
    observer.observe(svg);
    return () => {
      observer.disconnect();
      store.setOnScreen(id, false);
    };
  }, [id]);

  const dark = ICON.outline.fill;
  const wood = ICON.wood.fill;

  return (
    <>
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        <svg
          viewBox={ICON.viewBox}
          xmlns={SVG_NS}
          className="size-full"
          aria-hidden
        >
          <rect width="4096" height="4096" fill={ICON.ground} />
        </svg>
      </span>
      {children}
      <span className="pointer-events-none absolute inset-0">
        <svg
          ref={svgRef}
          data-role="assistant-face"
          viewBox={ICON.viewBox}
          xmlns={SVG_NS}
          overflow="visible"
          className="pointer-events-none size-full"
          aria-hidden
        >
          <g data-face={BOB_PART}>
            <g data-face="move">
              <g transform={`translate(${MARK_ANCHOR.x} ${MARK_ANCHOR.y})`}>
                <g data-face="markMove">
                  <g data-face="markScale">
                    {(Object.keys(MARK_GLYPHS) as MarkKind[]).map((kind) => {
                      const glyph = MARK_GLYPHS[kind];
                      return (
                        <g
                          key={kind}
                          data-face={MARK_PART[kind]}
                          opacity={REST_VALUE[MARK_PART[kind]]}
                          className={MARK_TONE[kind]}
                        >
                          {glyph.stroke && (
                            <path
                              d={glyph.stroke}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={MARK_STROKE}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                          {glyph.fill && (
                            <path d={glyph.fill} fill="currentColor" />
                          )}
                          {glyph.dot && (
                            <circle
                              cx={glyph.dot.cx}
                              cy={glyph.dot.cy}
                              r={glyph.dot.r}
                              fill="currentColor"
                            />
                          )}
                        </g>
                      );
                    })}
                  </g>
                </g>
              </g>
              <g data-face="turn">
                <g transform={`translate(${FIGURE_FOOT.x} ${FIGURE_FOOT.y})`}>
                  <g data-face="squash">
                    <g
                      transform={`translate(${-FIGURE_FOOT.x} ${-FIGURE_FOOT.y})`}
                    >
                      <g transform={ICON.transform}>
                        <path
                          data-face="outline"
                          d={ICON.outline.d}
                          fill={dark}
                          fillRule={ICON.outline.fillRule}
                        />
                        <path
                          data-face="wood"
                          d={ICON.wood.d}
                          fill={wood}
                          fillRule={ICON.wood.fillRule}
                        />
                        <FaceOverlay dark={dark} wood={wood} />
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </svg>
      </span>
    </>
  );
}

/** What lies over the drawing's face while the eyes or the mouth move:
 * wood over the eye holes and the mouth, the eyes in every shape, the
 * mouth in every size. Hidden at rest. */
function FaceOverlay({ dark, wood }: { dark: string; wood: string }) {
  return (
    <g data-face="overlay" opacity={REST_VALUE.overlay}>
      {EYES.map((eye) => (
        <path
          key={eye.cx}
          d={eye.d}
          fill={wood}
          stroke={wood}
          strokeWidth={PLUG_RIM * 2}
          strokeLinejoin="round"
        />
      ))}
      <g transform={`translate(${LIP_ORIGIN_X} ${LIP.top})`}>
        <g
          data-face="lip"
          transform={partAttribute("lip", REST_VALUE.lip).value}
        >
          <rect
            x={-LIP.width / 2}
            y={0}
            width={LIP.width}
            height={LIP.shutBottom - LIP.top}
            fill={wood}
          />
        </g>
      </g>
      <g transform={`translate(${JAW_ORIGIN_X} ${JAW.top})`}>
        <g
          data-face="jaw"
          transform={partAttribute("jaw", REST_VALUE.jaw).value}
        >
          <rect
            x={-JAW.width / 2}
            y={0}
            width={JAW.width}
            height={JAW_FULL}
            rx={JAW.corner}
            fill={dark}
          />
        </g>
      </g>
      <g data-face="mouthO" opacity={REST_VALUE.mouthO}>
        <ellipse
          cx={MOUTH_O.cx}
          cy={MOUTH_O.cy}
          rx={MOUTH_O.rx}
          ry={MOUTH_O.ry}
          fill={dark}
        />
      </g>
      <g data-face="grin" opacity={REST_VALUE.grin}>
        <path d={GRIN_PATH} fill={dark} />
      </g>
      <g data-face="gaze">
        <g data-face="discs">
          {EYES.map((eye, i) => (
            <g key={eye.cx} data-face={i === 0 ? "shiftL" : "shiftR"}>
              <g transform={`translate(${eye.cx} ${eye.cy})`}>
                <g data-face={i === 0 ? "eyeL" : "eyeR"}>
                  <path
                    d={eye.d}
                    fill={dark}
                    transform={`translate(${-eye.cx} ${-eye.cy})`}
                  />
                </g>
              </g>
            </g>
          ))}
        </g>
        <g data-face="smile" opacity={REST_VALUE.smile}>
          {EYES.map((eye) => (
            <path
              key={eye.cx}
              d={smilePath(eye)}
              fill="none"
              stroke={dark}
              strokeWidth={SMILE_STROKE}
              strokeLinecap="round"
            />
          ))}
        </g>
        <g data-face="sleepy" opacity={REST_VALUE.sleepy}>
          {EYES.map((eye) => (
            <path
              key={eye.cx}
              d={sleepPath(eye)}
              fill="none"
              stroke={dark}
              strokeWidth={SLEEP_STROKE}
              strokeLinecap="round"
            />
          ))}
        </g>
        <g data-face="strain" opacity={REST_VALUE.strain}>
          {EYES.map((eye, i) => (
            <path
              key={eye.cx}
              d={strainPath(eye, i)}
              fill="none"
              stroke={dark}
              strokeWidth={STRAIN_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </g>
        <g data-face="cross" opacity={REST_VALUE.cross}>
          {EYES.map((eye) => (
            <path
              key={eye.cx}
              d={crossPath(eye)}
              fill="none"
              stroke={dark}
              strokeWidth={CROSS_STROKE}
              strokeLinecap="round"
            />
          ))}
        </g>
      </g>
    </g>
  );
}
