import { useEffect, useId, useRef } from "react";

import type { FaceBeat, FacePose } from "@/lib/assistant-face-motion";
import { useAssistantFaceStore } from "@/stores/assistant-face";

import {
  EYES,
  ICON,
  LIP,
  PLUG_RIM,
  SLEEP_STROKE,
  SMILE_STROKE,
  sleepPath,
  smilePath,
} from "./assistant-face-geometry";
import {
  BOB_PART,
  FACE_PARTS,
  FIGURE_CENTRE,
  type FacePart,
  partAnimation,
  partAttribute,
  partValue,
  REST_VALUE,
} from "./face-smil";

const SVG_NS = "http://www.w3.org/2000/svg";
/** The strip over the mouth scales from the middle of its top. */
const LIP_ORIGIN_X = LIP.x + LIP.width / 2;
/** Parts whose markup carries their rest value (the others carry none). */
const MARKUP_REST: Partial<Record<FacePart, string>> = {
  smile: REST_VALUE.smile,
  sleepy: REST_VALUE.sleepy,
  overlay: REST_VALUE.overlay,
  lip: REST_VALUE.lip,
};

type Parts = Partial<Record<FacePart, SVGGElement>>;

/** The moving parts, found by their `data-face` names. */
function findParts(svg: SVGSVGElement): Parts {
  const parts: Parts = {};
  for (const part of FACE_PARTS) {
    const el = svg.querySelector<SVGGElement>(`[data-face="${part}"]`);
    if (el) parts[part] = el;
  }
  return parts;
}

/** Hold a part at a pose between beats: its attribute, or the bare
 * markup when the pose is the drawing's. */
function holdPart(part: FacePart, el: SVGGElement, pose: FacePose): void {
  const value = partValue(part, pose);
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
function dropAnimations(el: SVGGElement): void {
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
  const first = beat.frames[0].pose;
  const end = beat.frames[beat.frames.length - 1].pose;
  const started: SVGAnimationElement[] = [];
  for (const part of FACE_PARTS) {
    const el = parts[part];
    if (!el) continue;
    holdPart(part, el, first);
    dropAnimations(el);
    const spec = beat.duration > 0 ? partAnimation(part, beat) : null;
    if (!spec) {
      holdPart(part, el, end);
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
    holdPose(parts, end);
    return;
  }
  const settle = () => {
    // Only if this beat is still the one playing.
    if (!started[0]?.isConnected) return;
    holdPose(parts, end);
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
  const end = beat.frames[beat.frames.length - 1].pose;
  const hold = (pose: FacePose) => {
    const value = partValue("move", pose);
    if (value === REST_VALUE.move) bob.removeAttribute("transform");
    else bob.setAttribute("transform", partAttribute("move", value).value);
  };
  const spec = beat.duration > 0 ? partAnimation("move", beat) : null;
  if (!spec) {
    hold(end);
    return;
  }
  hold(beat.frames[0].pose);
  const animation = document.createElementNS(SVG_NS, spec.element);
  for (const [name, value] of Object.entries(spec.attributes)) {
    animation.setAttribute(name, value);
  }
  bob.appendChild(animation);
  const smil = animation as SVGAnimationElement;
  if (typeof smil.beginElement !== "function") {
    dropAnimations(bob);
    hold(end);
    return;
  }
  smil.addEventListener(
    "endEvent",
    () => {
      if (!smil.isConnected) return;
      hold(end);
      dropAnimations(bob);
    },
    { once: true },
  );
  smil.beginElement();
}

/**
 * The assistant's avatar as a face that moves (main chat ticket 65, PRD
 * ruling 117): the app icon drawn inline from its own vector master
 * (assistant-face-geometry.ts), so at rest it is the icon pixel for
 * pixel, with its eyes and mouth able to move. It plays the beats the
 * face director writes to the shared store, so every avatar on screen —
 * the sidebar card's, the header's — plays the same one at the same
 * time; one mounted later takes the pose the face holds.
 *
 * The parts are nested groups, one kind of transform each, so that the
 * head rises and falls under everything while it works (`bob`, its own
 * channel), the figure moves (`move`), tilts about the avatar's centre
 * (`turn`) and scales about it (`squash`) as one, each eye opens about
 * its own centre and the strip over the mouth comes down from its top.
 *
 * It tells the store whether it is on screen (the director starts
 * nothing while none is). Decoration: hidden from screen readers.
 */
export function AssistantFace() {
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
  const c = FIGURE_CENTRE;

  return (
    <svg
      ref={svgRef}
      data-role="assistant-face"
      viewBox={ICON.viewBox}
      xmlns={SVG_NS}
      className="pointer-events-none size-full"
      aria-hidden
    >
      <rect width="4096" height="4096" fill={ICON.ground} />
      <g data-face={BOB_PART}>
        <g data-face="move">
          <g data-face="turn">
            <g transform={`translate(${c} ${c})`}>
              <g data-face="squash">
                <g transform={`translate(${-c} ${-c})`}>
                  <g transform={ICON.transform}>
                    <path
                      d={ICON.outline.d}
                      fill={dark}
                      fillRule={ICON.outline.fillRule}
                    />
                    <path
                      d={ICON.wood.d}
                      fill={wood}
                      fillRule={ICON.wood.fillRule}
                    />
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
                      <g data-face="gaze">
                        <g data-face="discs">
                          {EYES.map((eye, i) => (
                            <g
                              key={eye.cx}
                              transform={`translate(${eye.cx} ${eye.cy})`}
                            >
                              <g data-face={i === 0 ? "eyeL" : "eyeR"}>
                                <path
                                  d={eye.d}
                                  fill={dark}
                                  transform={`translate(${-eye.cx} ${-eye.cy})`}
                                />
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
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
