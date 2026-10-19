import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { makeSession } from "@/test/factories";

import {
  AssistantAvatar,
  AssistantAvatarBadge,
  type AssistantAvatarSize,
  type AssistantBadgeSize,
} from "./AssistantAvatar";
import { AssistantIdentity } from "./AssistantIdentity";

/**
 * The assistant's avatar is the app icon (main chat PRD ruling 70,
 * ticket 23): the icon's vector master cropped to a circle, a 1px ring
 * inside it. Still at 28 (the header's identity row, ruling 119 point
 * 6); the sidebar card's stage draws it as the face that moves, at 72
 * and 48 (AssistantFace.test.tsx, Sidebar.main-chat.test.tsx).
 */

const ROOT = path.resolve(__dirname, "../../../../..");
const AVATAR = 'data-role="assistant-avatar"';
const RING = 'data-role="assistant-avatar-ring"';

const render = (size?: AssistantAvatarSize) =>
  renderToStaticMarkup(<AssistantAvatar size={size} />);

/** The opening tag of the element carrying `marker`. */
const tagWith = (html: string, marker: string) => {
  const at = html.indexOf(marker);
  expect(at).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};

describe("the assistant's avatar", () => {
  it("shows the app icon's picture, not a disc and a letter", () => {
    const html = render();
    const img = tagWith(html, "<img");
    expect(img).toMatch(/src="[^"]*\/galley-icon\.svg"/);
    expect(img).toContain('alt=""');
    expect(html).not.toMatch(/>G</);
    expect(html).not.toMatch(/bg-brand|font-serif|italic/);
  });

  it("crops it to a circle, 28px by default, 48 and 72 for the stage", () => {
    for (const [size, box] of [
      [undefined, "size-7"],
      [28, "size-7"],
      [48, "size-12"],
      [72, "size-18"],
    ] as const) {
      const avatar = tagWith(render(size), AVATAR);
      expect(avatar).toContain(box);
      expect(avatar).toContain("rounded-full");
      expect(avatar).toContain("overflow-hidden");
      // The picture fills the circle.
      expect(tagWith(render(size), "<img")).toContain("size-full");
    }
    expect(tagWith(render(28), AVATAR)).not.toContain("size-18");
    expect(tagWith(render(72), AVATAR)).not.toContain("size-7");
  });

  it("draws a 1px ring inside the circle, over the picture", () => {
    const html = render(72);
    const ring = tagWith(html, RING);
    expect(ring).toContain("absolute inset-0 rounded-full");
    expect(ring).toContain("shadow-[inset_0_0_0_1px_var(--color-avatar-ring)]");
    // After the picture, so it paints on top of it.
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf(RING));
    // Inside: nothing outside the box adds to its size.
    expect(tagWith(html, AVATAR)).not.toMatch(/\b(border|ring|outline)\b/);
    expect(tagWith(html, AVATAR)).toContain("relative");
  });

  it("rings in black 12% in light, white 10% in dark", () => {
    const css = readFileSync(
      path.join(ROOT, "gui/src/styles/globals.css"),
      "utf8",
    );
    const dark = css.indexOf('html[data-theme="dark"] {');
    expect(dark).toBeGreaterThan(0);
    expect(css.slice(0, dark)).toContain(
      "--color-avatar-ring: rgba(0, 0, 0, 0.12);",
    );
    expect(css.slice(dark)).toContain(
      "--color-avatar-ring: rgba(255, 255, 255, 0.1);",
    );
  });

  it("is decoration: hidden from screen readers, never dragged, selected or hit", () => {
    const html = render();
    const avatar = tagWith(html, AVATAR);
    expect(avatar).toContain('aria-hidden="true"');
    expect(avatar).toContain("select-none");
    const img = tagWith(html, "<img");
    expect(img).toContain('draggable="false"');
    expect(img).toContain("pointer-events-none");
    expect(tagWith(html, RING)).toContain("pointer-events-none");
  });

  it("is the icon's vector master, byte for byte", () => {
    // scripts/render-app-icons.py copies it; the app icons render from it.
    expect(
      readFileSync(path.join(ROOT, "gui/src/assets/galley-icon.svg")),
    ).toEqual(
      readFileSync(path.join(ROOT, "core/icons/master/galley-icon.svg")),
    );
  });
});

describe("the avatar's badge", () => {
  const at = (size: AssistantBadgeSize) =>
    tagWith(
      renderToStaticMarkup(<AssistantAvatarBadge kind="ask" size={size} />),
      'data-role="assistant-badge"',
    );

  it("sits on the circle's 45° point at both stage sizes", () => {
    expect(at(48)).toContain("size-4");
    expect(at(48)).toContain("-right-px -top-px");
    expect(at(72)).toContain("size-5");
    expect(at(72)).toContain("right-[0.5px] top-[0.5px]");
    // Ringed in the card's ground.
    expect(at(72)).toContain(
      "bg-[var(--assistant-ground,var(--color-chrome))]",
    );
  });

  it("spins while it runs only when the face cannot say it", () => {
    expect(
      renderToStaticMarkup(<AssistantAvatarBadge kind="running" size={72} />),
    ).toContain('class="spin"');
    expect(
      renderToStaticMarkup(
        <AssistantAvatarBadge kind="running" size={72} faceRuns />,
      ),
    ).toBe("");
    // A question keeps its mark either way.
    expect(
      renderToStaticMarkup(
        <AssistantAvatarBadge kind="ask" size={72} faceRuns />,
      ),
    ).toContain('data-kind="ask"');
  });

  it("is absent at rest", () => {
    expect(
      renderToStaticMarkup(<AssistantAvatarBadge kind="idle" size={72} />),
    ).toBe("");
  });
});

describe("the header's 28px avatar stays still (ruling 119 point 6)", () => {
  it("draws the still icon, not the face", () => {
    const mainChat = makeSession({
      id: "s-main",
      mainChat: true,
      gaRuntimeKind: "managed",
      runtimeKind: "managed",
    });
    const html = renderToStaticMarkup(
      <AssistantIdentity mainChat={mainChat} subtasks={[]} />,
    );
    expect(html).not.toContain('data-role="assistant-face"');
    expect(tagWith(html, "<img")).toMatch(/src="[^"]*\/galley-icon\.svg"/);
    expect(tagWith(html, AVATAR)).toContain("size-7");
    // No badge here: the line under the name says the state.
    expect(html).not.toContain('data-role="assistant-badge"');
  });
});
