import {
  Circle,
  CircleNotch,
  PauseCircle,
  XCircle,
} from "@phosphor-icons/react";

import galleyIconUrl from "@/assets/galley-icon.svg";
import type { AssistantStateKind } from "@/lib/assistant";
import { cn } from "@/lib/utils";

import { AssistantFace } from "./AssistantFace";

/** The avatar's sizes: 28 in the main header's identity row, 40 on the
 * sidebar's assistant card; 票 66 临时切换器，定档后由拆除票删掉：the
 * trial's stage card adds 72, and 48 on a narrow sidebar. */
export type AssistantAvatarSize = 28 | 40 | 48 | 72;

const DISC: Record<AssistantAvatarSize, string> = {
  28: "size-7",
  40: "size-10",
  48: "size-12",
  72: "size-18",
};

/**
 * The assistant's face is the app icon (main chat PRD ruling 70, ticket
 * 23). It is called Galley, like the app, and when it is not in front of
 * you it reaches you through system notifications, whose picture macOS
 * fixes to the app icon, as the Dock does: one name, one face. The icon
 * is itself a character with a face (a wooden robot whose long tongue
 * makes the G), so it reads as an IM avatar.
 *
 * One drawing, two crops: the asset is the icon's vector master
 * (core/icons/master/galley-icon.svg, kept identical by a test), a full
 * square whose figure sits inside the centre circle; the app icons round
 * it into a square, the avatar into a circle. SVG rather than an
 * exported PNG: sharp at both sizes on any display scale.
 *
 * A 1px ring is drawn inside the circle, over the picture, so the outer
 * size stays 28 / 40: black 12% in light, white 10% in dark (the
 * `--color-avatar-ring` token follows the theme). The icon's pale ground
 * (L* 89) sits within L* 1–5 of the light sidebar's fills (chrome 94,
 * hover 90, selected 87), so without the ring the avatar has no edge.
 */
export function AssistantAvatar({
  size = 28,
  animated = false,
  amplitude = 1,
  className,
}: {
  size?: AssistantAvatarSize;
  /** 票 66 临时切换器，定档后由拆除票删掉：the face that moves
   * (AssistantFace) in place of the still picture; at rest the two are
   * the same pixels. Its figure is not cropped to the circle (it jumps
   * out of it; the marks sit beside it), only its ground. */
  animated?: boolean;
  /** 票 66 临时切换器，定档后由拆除票删掉：the trial's 幅度. */
  amplitude?: number;
  className?: string;
}) {
  if (animated) {
    return (
      <span
        aria-hidden
        data-role="assistant-avatar"
        className={cn(
          "relative inline-flex shrink-0 select-none rounded-full",
          DISC[size],
          className,
        )}
      >
        <AssistantFace amplitude={amplitude}>
          <span
            data-role="assistant-avatar-ring"
            className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_var(--color-avatar-ring)]"
          />
        </AssistantFace>
      </span>
    );
  }
  return (
    <span
      aria-hidden
      data-role="assistant-avatar"
      className={cn(
        "relative inline-flex shrink-0 select-none overflow-hidden rounded-full",
        DISC[size],
        className,
      )}
    >
      <img
        src={galleyIconUrl}
        alt=""
        draggable={false}
        className="pointer-events-none size-full"
      />
      <span
        data-role="assistant-avatar-ring"
        className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_var(--color-avatar-ring)]"
      />
    </span>
  );
}

// Badge diameter and glyph size per disc, and where the badge sits: its
// centre on the disc's 45° point, r(1 − 1/√2) in from the box corner
// (28: 4.1px, 40: 5.86px), a 1.5px ring around the glyph. 票 66 临时切换
// 器，定档后由拆除票删掉：the trial's sizes on the same rule (48: 7.03px,
// 72: 10.54px), the badge a little larger with the disc (16 / 20px,
// glyphs 13 / 16).
const BADGE: Record<
  AssistantAvatarSize,
  { box: string; glyph: number; at: string }
> = {
  28: { box: "size-[15px]", glyph: 12, at: "-right-[3px] -top-[3px]" },
  40: { box: "size-4", glyph: 13, at: "-right-[2px] -top-[2px]" },
  48: { box: "size-4", glyph: 13, at: "-right-px -top-px" },
  72: { box: "size-5", glyph: 16, at: "right-[0.5px] top-[0.5px]" },
};

/**
 * The avatar's mark for a state: a session row's status icon in the
 * badge corner (layout-and-chrome.md, Session Row) — the spinning bold
 * brand ring while it runs, the filled amber pause of a question, the
 * red x of an error (filled: the row's thin one is illegible this
 * small), the filled apricot dot of a new reply (a step stronger than
 * the row's, to stand off the icon's apricot ground; WeChat's corner
 * dot).
 * Nothing at rest, or for a draft.
 *
 * Ringed in what the card is filled with right now, so it reads as cut
 * into the avatar's corner: the card sets `--assistant-ground` (chrome,
 * hover, selected) and the ring follows.
 *
 * The header bans status dots (§4.1 禁止) because a dot reads as an
 * unread message; here the only dot is unread, so that reading is the
 * meaning.
 */
export function AssistantAvatarBadge({
  kind,
  size,
  pop = false,
  faceRuns = false,
  className,
}: {
  kind: AssistantStateKind;
  size: AssistantAvatarSize;
  /** Play the entry pop (a state just became news). */
  pop?: boolean;
  /** 票 66 临时切换器，定档后由拆除票删掉：the face says it is busy, so
   * no spinner (ruling 117 point 1: the spinner is 「the program is
   * loading」); a question, an error and a new reply keep their marks.
   * Not under reduced motion: the face is still there (point 8). */
  faceRuns?: boolean;
  /** 票 66 临时切换器，定档后由拆除票删掉：which sidebar widths show it
   * (the trial card switches its avatar's size by container query). */
  className?: string;
}) {
  if (kind === "idle") return null;
  if (kind === "running" && faceRuns) return null;
  const badge = BADGE[size];
  return (
    <span
      aria-hidden
      data-role="assistant-badge"
      data-kind={kind}
      className={cn(
        "pointer-events-none absolute inline-flex items-center justify-center rounded-full",
        "bg-[var(--assistant-ground,var(--color-chrome))]",
        badge.box,
        badge.at,
        pop && "sidebar-state-pop",
        className,
      )}
    >
      {kind === "running" ? (
        <span className="spin">
          <CircleNotch
            size={badge.glyph}
            weight="bold"
            className="text-brand-strong"
          />
        </span>
      ) : kind === "ask" ? (
        <PauseCircle
          size={badge.glyph}
          weight="fill"
          className="text-warning"
        />
      ) : kind === "error" ? (
        <XCircle size={badge.glyph} weight="fill" className="text-error" />
      ) : (
        <Circle
          size={Math.round(badge.glyph * 0.75)}
          weight="fill"
          className="text-brand-strong"
        />
      )}
    </span>
  );
}
