import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  basePose,
  NEUTRAL_POSE,
  reactionBeat,
  turnBeat,
} from "@/lib/assistant-face-motion";

import { AssistantAvatar } from "./AssistantAvatar";
import { AssistantFace } from "./AssistantFace";
import {
  EYES,
  ICON,
  lipScale,
  LIP,
  parseIcon,
} from "./assistant-face-geometry";
import { FACE_PARTS, partAnimation, partValue, REST_VALUE } from "./face-smil";

/**
 * The face that moves (ticket 65) is the app icon taken apart, not
 * redrawn: at rest it draws the master's own pieces and nothing else.
 * (Its pixels against the still avatar's were compared in headless
 * Chrome, 28 / 40 / 64 / 72 × light / dark: no pixel differs.)
 */

const ROOT = path.resolve(__dirname, "../../../../..");
const MASTER = readFileSync(
  path.join(ROOT, "core/icons/master/galley-icon.svg"),
  "utf8",
);

describe("the master, taken apart", () => {
  it("reads the ground, the group's transform and the two paths as the file has them", () => {
    const icon = parseIcon(MASTER);
    expect(icon).toEqual(ICON);
    expect(icon.viewBox).toBe("0 0 4096 4096");
    expect(icon.ground).toBe("#fcdba9");
    expect(icon.transform).toBe("translate(-4 122)");
    expect(MASTER).toContain(`d="${icon.outline.d}"`);
    expect(MASTER).toContain(`d="${icon.wood.d}"`);
    expect(icon.outline.fill).toBe("#291a11");
    expect(icon.wood.fill).toBe("#f9c071");
  });

  it("finds the two eyes, the wood's round holes, left first", () => {
    expect(EYES).toHaveLength(2);
    expect(EYES[0].cx).toBeLessThan(EYES[1].cx);
    for (const eye of EYES) {
      expect(ICON.wood.d).toContain(eye.d);
      expect(eye.cy).toBeGreaterThan(1850);
      expect(eye.cy).toBeLessThan(1950);
    }
  });

  it("throws on a master of another shape", () => {
    expect(() =>
      parseIcon(
        '<svg viewBox="0 0 1 1"><rect fill="#fff"/><g transform="x"><path d="M0 0" fill="#000"/></g></svg>',
      ),
    ).toThrow();
  });

  it("closes the mouth with a strip from its top: as drawn at 0, down to the lip at 1", () => {
    expect(LIP.top + (LIP.shutBottom - LIP.top) * lipScale(0)).toBeCloseTo(
      LIP.restBottom,
      6,
    );
    expect(lipScale(1)).toBeCloseTo(1, 6);
  });
});

describe("the face at rest", () => {
  const html = renderToStaticMarkup(<AssistantFace />);

  it("draws the master's pieces in its own order", () => {
    expect(html).toContain(`fill="${ICON.ground}"`);
    expect(html.indexOf(ICON.outline.d)).toBeGreaterThan(0);
    expect(html.indexOf(ICON.outline.d)).toBeLessThan(
      html.indexOf(ICON.wood.d),
    );
    expect(html).toContain(`transform="${ICON.transform}"`);
  });

  it("hides what it lays over the drawing, and plays nothing", () => {
    expect(html).toMatch(/data-face="overlay" opacity="0"/);
    expect(html).toMatch(/data-face="smile" opacity="0"/);
    expect(html).toMatch(/data-face="sleepy" opacity="0"/);
    expect(html).not.toMatch(/<animate/);
    // The figure's groups carry no transform of their own at rest.
    for (const part of [
      "bob",
      "move",
      "turn",
      "squash",
      "gaze",
      "eyeL",
      "eyeR",
    ]) {
      const tag = html
        .slice(html.indexOf(`data-face="${part}"`) - 4)
        .split(">")[0];
      expect(tag, part).not.toContain("transform=");
    }
  });

  it("is decoration, and the avatar shows it only when asked", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none");
    expect(
      renderToStaticMarkup(<AssistantAvatar size={72} animated />),
    ).toContain('data-role="assistant-face"');
    const still = renderToStaticMarkup(<AssistantAvatar size={72} />);
    expect(still).not.toContain('data-role="assistant-face"');
    expect(still).toMatch(/src="[^"]*\/galley-icon\.svg"/);
  });
});

describe("a beat as SMIL", () => {
  const rand = () => 0.5;
  const turn = turnBeat(NEUTRAL_POSE, basePose("read"), "read");

  it("animates only the parts that move, transforms and opacity only", () => {
    const moving = FACE_PARTS.filter((part) => partAnimation(part, turn));
    expect(moving).toEqual(["gaze", "overlay"]);
    for (const part of FACE_PARTS) {
      const spec = partAnimation(
        part,
        reactionBeat("done", NEUTRAL_POSE, NEUTRAL_POSE, rand),
      );
      if (!spec) continue;
      expect(["transform", "opacity"]).toContain(spec.attributes.attributeName);
      expect(spec.attributes.begin).toBe("indefinite");
      expect(spec.attributes.fill).toBe("freeze");
    }
  });

  it("keys the frames with their curves", () => {
    const spec = partAnimation("gaze", turn)!;
    expect(spec.element).toBe("animateTransform");
    expect(spec.attributes.type).toBe("translate");
    expect(spec.attributes.keyTimes).toBe("0;1");
    expect(spec.attributes.values).toBe(
      `0 0;${partValue("gaze", basePose("read"))}`,
    );
    expect(spec.attributes.keySplines.split(";")).toHaveLength(1);
    expect(spec.attributes.dur).toBe(`${turn.duration}ms`);
  });

  it("shows the overlay through the beat, hiding it at the end only at rest", () => {
    const blinkBack = reactionBeat("stop", NEUTRAL_POSE, NEUTRAL_POSE, rand);
    expect(partAnimation("overlay", blinkBack)!.attributes.values).toBe("1;0");
    expect(partAnimation("overlay", turn)!.attributes.values).toBe("1;1");
    expect(
      partAnimation(
        "overlay",
        turnBeat(NEUTRAL_POSE, { ...NEUTRAL_POSE, y: 40 }, "idle"),
      ),
    ).toBeNull();
  });

  it("knows the markup's rest values", () => {
    for (const part of FACE_PARTS) {
      expect(partValue(part, NEUTRAL_POSE), part).toBe(REST_VALUE[part]);
    }
  });
});
