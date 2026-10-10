import { invoke } from "@tauri-apps/api/core";

/**
 * Remote access for paired phones (ticket 05d, Settings → Phone). Core's
 * remote module owns all of it — the pairing key, the connection to the
 * phones; this page only asks and listens. Wire types and command
 * wrappers only. The module exists only in a build that knows where to
 * connect; without it the status is `null` and the Phone tab never shows.
 */

/** Mirror of core/src/remote/mod.rs REMOTE_STATUS_EVENT. */
export const REMOTE_STATUS_EVENT = "remote-status";

/** Mirror of core/src/remote/mod.rs RemoteStatus. */
export interface RemoteStatus {
  /** A pairing key exists; Core keeps a connection open only then. */
  paired: boolean;
  /** Core's connection for the phones is up. */
  relayConnected: boolean;
  /** Phones connected right now. */
  onlinePhones: number;
  /** ISO 8601: the last time a phone connected, since Core started. */
  lastPhoneConnectedAt: string | null;
}

/** Mirror of core/src/commands/remote.rs RemotePairing. */
export interface RemotePairing {
  /** The pairing QR code as SVG markup; the code itself stays in Core. */
  qrSvg: string;
}

/** Core's status, or `null` when remote access does not exist in this
 * build. */
export async function getRemoteStatus(): Promise<RemoteStatus | null> {
  return invoke<RemoteStatus | null>("get_remote_status");
}

/** The QR code a phone scans to pair. Showing it again gives the same
 * code; phones already paired stay paired. */
export async function pairRemotePhone(): Promise<RemotePairing> {
  return invoke<RemotePairing>("pair_remote_phone");
}

/** Disconnect every phone and void the code: each phone scans again. */
export async function unpairRemotePhones(): Promise<void> {
  await invoke("unpair_remote_phones");
}
