/**
 * Runtime payload types — desktop-side.
 *
 * Historical note (2026-05-12): this file is named `inspector.ts`
 * because the shapes here originally fed a right-pane Inspector with
 * Details / Runtime tabs (among others). That panel was retired along
 * with its audit-log shape; `RuntimeInfo` still drives Settings →
 * Runtime. The filename stays the same to
 * avoid a wave of import-path churn — rename to `runtime.ts`
 * whenever we're already touching every importer.
 */

import type { RuntimeKind } from "@/types/session";

/**
 * Health check single check. Driven from the bridge's `ready` event
 * and any subsequent re-runs. Follows DESIGN.md §6.1's six states.
 */
export type HealthCheckState =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "warning"
  | "blocked";

export interface HealthCheckItem {
  name: string;
  detail?: string;
  state: HealthCheckState;
}

/**
 * Runtime tab payload. Combines the Health Check status with
 * bridge-level metadata that the user often wants at a glance.
 */
export interface RuntimeInfo {
  /** Empty until the user attaches an external GenericAgent folder. */
  gaPath: string;
  pythonVersion: string;
  /** Active LLM UI label from the bridge runtime-mode display rule. */
  llmDisplayName: string;
  /** Bridge subprocess PID for the active session, if any. */
  bridgePid?: number;
  /** User's actual GA HEAD commit (full SHA from ReadyEvent.gaCommit).
   * `"unknown"` if ga_path isn't a git checkout. Distinct from
   * `gaBaseline` below: this is what the user is *running right
   * now*, baseline is what we tested with. */
  gaCommit: string;
  /** ISO 8601 commit date of the user's GA HEAD. Same `"unknown"`
   * fallback. Pairs with `gaCommit` for the Settings → Runtime
   * version row. */
  gaCommitDate: string;
  /** Runtime of the session whose `ready` wrote `gaCommit` /
   * `gaCommitDate`. Unset until one has: the defaults are the bundled
   * engine's manifest commit, a first-paint placeholder. Only external
   * sessions write it today (a bundled-engine `ready` reports the
   * engine's own manifest commit, which 高级诊断 already shows), so the
   * 接入外部 GA version card renders only when this is `"external"`. */
  gaCommitRuntimeKind?: RuntimeKind;
  /** Galley-side tested baseline commit (from docs/ga-baseline.md).
   * Hardcoded — bumped whenever we re-verify
   * upstream compatibility. */
  gaBaseline: string;
  /** Workbench app version (e.g. "0.1.0"). */
  workbenchVersion: string;
  /** Galley-owned managed GA runtime layout and version diagnostics. */
  managedRuntime?: ManagedRuntimeDiagnostics;
}

export interface ManagedRuntimeDiagnostics {
  manifestSchemaVersion: number;
  upstreamSource: string;
  upstreamBranch: string;
  upstreamCommit: string;
  upstreamAuditedAt: string;
  patchStackId: string;
  patchCount: number;
  stateSchemaVersion: number;
  promptProfileId: string;
  promptHash: string;
  paths: ManagedRuntimePaths;
  code: ManagedCodeDiagnostics;
  state: ManagedStateDiagnostics;
}

export interface ManagedRuntimePaths {
  resourceRoot: string;
  codeRoot: string;
  memorySeedDir: string;
  manifestPath: string;
  patchManifestPath: string;
  stateRoot: string;
  memoryDir: string;
  sopDir: string;
  skillsDir: string;
  tempDir: string;
  modelResponsesDir: string;
  modelConfigDir: string;
  modelConfigPath: string;
}

export interface ManagedCodeDiagnostics {
  resourceRootExists: boolean;
  codeRootExists: boolean;
  agentmainExists: boolean;
  manifestExists: boolean;
  patchManifestExists: boolean;
}

export interface ManagedStateDiagnostics {
  initialized: boolean;
  createdDirs: string[];
  modelConfigExists: boolean;
  memorySeed: ManagedMemorySeedDiagnostics;
}

export interface ManagedMemorySeedDiagnostics {
  sourceExists: boolean;
  criticalFilesPresent: boolean;
  criticalFilesMissing: string[];
  copiedFiles: string[];
}
