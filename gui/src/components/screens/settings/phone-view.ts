import type { AppCopy } from "@/lib/i18n";
import type { RemoteStatus } from "@/lib/remote";

import type { SettingsStatusTone } from "./settings-badges";

/**
 * Pure view logic for Settings → Phone (ticket 05d): Core's remote status
 * plus the page's own QR state in, what to draw out. The component only
 * renders what this returns.
 *
 * Wording rule: the page never names the relay. To the user the phone
 * connects to this computer; Core's relay connection being down reads as
 * the network being unreachable for now.
 */

type PhoneCopy = AppCopy["settings"]["phone"];

/** The QR code on screen, and what it was shown against. */
export interface ShownQr {
  svg: string;
  /** `lastPhoneConnectedAt` when it was shown: once paired, a phone
   * connecting after that (the time moves) is the scan, and the code
   * folds away. */
  since: string | null;
  /** Core has reported the pairing this code started (`pairing`). The
   * command's answer can arrive before that report, so until then a
   * `pairing` of false is not yet the end of it. */
  pairingSeen: boolean;
}

/**
 * The code still on screen after `status`, or `null` once it is done;
 * the same object when nothing changed.
 *
 * - Not paired, the code is a pending pairing's: it lives as long as
 *   Core's `pairing` — gone when that turns false (timed out, cancelled).
 * - Paired: it stays until a phone connects after it was shown. That is
 *   also how the first pairing's code goes: its phone made Core paired.
 *
 * Hide pairing code, leaving the page and unpairing drop it in the
 * component.
 */
export function settleQr(
  status: RemoteStatus,
  qr: ShownQr | null,
): ShownQr | null {
  if (qr === null) return null;
  if (status.paired) {
    return status.lastPhoneConnectedAt === qr.since ? qr : null;
  }
  if (status.pairing) {
    return qr.pairingSeen ? qr : { ...qr, pairingSeen: true };
  }
  return qr.pairingSeen ? null : qr;
}

/** Where a paired desktop's phones stand. */
export type PhoneConnectionKind = "online" | "idle" | "connecting";

export interface PhoneStatusRow {
  kind: PhoneConnectionKind;
  badge: { tone: SettingsStatusTone; label: string; spin: boolean };
  title: string;
  detail: string;
}

export interface PhonePageView {
  /**
   * Core's `paired`, nothing else:
   * - `pair`: not paired (pairing the first phone included) — one row
   *   (Pair a phone, with the show-code button as the primary action)
   *   and the code under it.
   * - `paired`: the status row, Add a phone (the code under it when
   *   shown), Unpair.
   */
  layout: "pair" | "paired";
  /** `null` in the `pair` layout. */
  status: PhoneStatusRow | null;
  showQr: boolean;
  /** The code on screen expires (a new pairing's; Add a phone shows the
   * stored key, which does not). */
  showQrExpiry: boolean;
  /** Core could not store the key when a phone answered the code. */
  pairingError: string | null;
  /** "Keep running when the window closes" is off: closing the window
   * quits Galley and the phones lose this computer. */
  showBackgroundHint: boolean;
}

export function phoneStatusRow(
  status: RemoteStatus,
  lastConnectedText: string | null,
  copy: PhoneCopy,
): PhoneStatusRow {
  if (!status.relayConnected) {
    return {
      kind: "connecting",
      badge: { tone: "neutral", label: copy.badgeConnecting, spin: true },
      title: copy.connectingTitle,
      detail: copy.connectingDetail,
    };
  }
  const detail = lastConnectedText
    ? copy.lastConnected(lastConnectedText)
    : copy.autoConnectHint;
  if (status.onlinePhones > 0) {
    return {
      kind: "online",
      badge: { tone: "success", label: copy.badgeOnline, spin: false },
      title: copy.onlineTitle(status.onlinePhones),
      detail,
    };
  }
  return {
    kind: "idle",
    badge: { tone: "neutral", label: copy.badgeIdle, spin: false },
    title: copy.idleTitle,
    detail,
  };
}

export function phonePageView({
  status,
  qr,
  keepInBackgroundOnClose,
  lastConnectedText,
  copy,
}: {
  status: RemoteStatus;
  /** The code on screen, already settled with {@link settleQr}. */
  qr: ShownQr | null;
  keepInBackgroundOnClose: boolean;
  /** `status.lastPhoneConnectedAt` in the app's date format. */
  lastConnectedText: string | null;
  copy: PhoneCopy;
}): PhonePageView {
  const paired = status.paired;
  return {
    layout: paired ? "paired" : "pair",
    status: paired ? phoneStatusRow(status, lastConnectedText, copy) : null,
    showQr: qr !== null,
    showQrExpiry: qr !== null && !paired,
    pairingError:
      !paired && status.pairing && status.pairingError
        ? copy.pairingNotSaved(status.pairingError)
        : null,
    showBackgroundHint: !keepInBackgroundOnClose,
  };
}

/** The SVG as an `<img>` source, so the markup is never injected into
 * the page. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
