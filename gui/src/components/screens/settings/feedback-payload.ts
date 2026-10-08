import type { ManagedRuntimeDiagnostics } from "@/types/inspector";
import type { RuntimeKind } from "@/types/session";

/**
 * The environment text Settings → 报告问题 previews, copies, and
 * prefills into the bug form — one builder, so all three stay the same
 * text ("what you see is what leaves").
 *
 * Privacy rule: versions and statuses only. Health check `detail`
 * strings are never read here — they carry local paths (DB file under
 * the user's home, external GA path).
 */

/** One `health_report` check, as the Tauri command returns it. */
export interface HealthCheckDto {
  id: string;
  status: string;
  detail?: string;
}

/** Agent API stable status meaning "this command does not probe that
 * check" — a placeholder row, noise in a bug report. */
const NOT_PROBED_STATUS = "deferred_b4";

/** `id=status; …` over the probed checks, or null when none is left. */
export function formatHealthLine(
  checks: readonly HealthCheckDto[],
): string | null {
  const probed = checks.filter((c) => c.status !== NOT_PROBED_STATUS);
  if (probed.length === 0) return null;
  return probed.map((c) => `${c.id}=${c.status}`).join("; ");
}

export interface FeedbackEnv {
  workbenchVersion: string;
  /** Display name ("macOS"), or null when the OS isn't recognized. */
  os: string | null;
  activeRuntimeKind: RuntimeKind;
  managedRuntime?: Pick<
    ManagedRuntimeDiagnostics,
    "upstreamCommit" | "patchStackId" | "patchCount"
  >;
  /** HEAD commit of the user's external GA, as an external session's
   * `ready` already reported it (never read anew for this). Only used
   * while the external engine is active. */
  externalGaCommit?: string;
  /** From `formatHealthLine`; null while loading, on failure, or when
   * every check is unprobed. */
  healthLine: string | null;
}

export interface FeedbackPayload {
  /** The preview / Copy text. */
  text: string;
  /** The bug form's `health` field (engine version lines, then the
   * health line), or null when there is nothing to put there. */
  healthField: string | null;
}

export function buildFeedbackPayload(env: FeedbackEnv): FeedbackPayload {
  const engineLines: string[] = [];
  if (env.activeRuntimeKind === "managed" && env.managedRuntime) {
    const m = env.managedRuntime;
    engineLines.push(
      `kernel: ${m.upstreamCommit.slice(0, 7)} (${m.patchStackId}, ${m.patchCount} patches)`,
    );
  }
  const gaCommit = env.externalGaCommit?.trim();
  if (
    env.activeRuntimeKind === "external" &&
    gaCommit &&
    // A non-git GA folder reports "unknown" (see GAVersionCard).
    gaCommit !== "unknown"
  ) {
    engineLines.push(`ga_commit: ${gaCommit.slice(0, 7)}`);
  }

  // Locale-independent keys on purpose: this text lands in a GitHub
  // issue, where stable ASCII keys outlive the reporter's UI language.
  const text = [
    `galley_version: ${env.workbenchVersion}`,
    `os: ${env.os ?? "unknown"}`,
    `engine: ${env.activeRuntimeKind}`,
    ...engineLines,
    ...(env.healthLine ? [`health: ${env.healthLine}`] : []),
  ].join("\n");

  const healthParts = [
    ...engineLines,
    ...(env.healthLine ? [env.healthLine] : []),
  ];
  return {
    text,
    healthField: healthParts.length > 0 ? healthParts.join("\n") : null,
  };
}
