import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AssistantAvatar,
  AssistantAvatarBadge,
  type AssistantAvatarSize,
} from "./AssistantAvatar";

/**
 * The assistant's avatar is the app icon (main chat PRD ruling 70,
 * ticket 23): the icon's vector master cropped to a circle, a 1px ring
 * inside it, at 28 (the header's identity row) and 40 (the sidebar card).
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

  it("crops it to a circle, 28px by default and 40px on the card", () => {
    for (const [size, box] of [
      [undefined, "size-7"],
      [28, "size-7"],
      [40, "size-10"],
    ] as const) {
      const avatar = tagWith(render(size), AVATAR);
      expect(avatar).toContain(box);
      expect(avatar).toContain("rounded-full");
      expect(avatar).toContain("overflow-hidden");
      // The picture fills the circle.
      expect(tagWith(render(size), "<img")).toContain("size-full");
    }
    expect(tagWith(render(28), AVATAR)).not.toContain("size-10");
    expect(tagWith(render(40), AVATAR)).not.toContain("size-7");
  });

  it("draws a 1px ring inside the circle, over the picture", () => {
    const html = render(40);
    const ring = tagWith(html, RING);
    expect(ring).toContain("absolute inset-0 rounded-full");
    expect(ring).toContain("shadow-[inset_0_0_0_1px_var(--color-avatar-ring)]");
    // After the picture, so it paints on top of it.
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf(RING));
    // Inside: nothing outside the box adds to 28 / 40.
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
  it("sits on the circle's 45° point at both sizes, as before", () => {
    const at = (size: AssistantAvatarSize) =>
      tagWith(
        renderToStaticMarkup(
          <AssistantAvatarBadge kind="running" size={size} />,
        ),
        'data-role="assistant-badge"',
      );
    expect(at(28)).toContain("size-[15px]");
    expect(at(28)).toContain("-right-[3px] -top-[3px]");
    expect(at(40)).toContain("size-4");
    expect(at(40)).toContain("-right-[2px] -top-[2px]");
    // Ringed in the card's ground.
    expect(at(40)).toContain(
      "bg-[var(--assistant-ground,var(--color-chrome))]",
    );
  });

  it("is absent at rest", () => {
    expect(
      renderToStaticMarkup(<AssistantAvatarBadge kind="idle" size={40} />),
    ).toBe("");
  });
});
