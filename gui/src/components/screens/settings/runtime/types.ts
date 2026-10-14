import type { RuntimeInfo } from "@/types/inspector";
import type { RuntimeKind } from "@/types/session";

export interface SettingsRuntimeProps {
  info: RuntimeInfo;
  hasRunningSessions: boolean;
  /** The managed runtime's main chat exists: Settings offers to reset
   * it (main chat ticket 15). */
  hasMainChat: boolean;
  activeRuntimeKind: RuntimeKind;
  hasManagedRuntimeConfigured: boolean;
  hasExternalRuntimeConfigured: boolean;
  /**
   * v0.1.1+: when false (default), Galley spawns its own bundled Python
   * interpreter and the Python panel is a read-only info card. When
   * true, the legacy picker UI is shown so the user can point Galley
   * at an external interpreter (their own venv, conda env, etc).
   */
  useExternalPython: boolean;
  onChangeGAPath?: () => void;
  onChangeBridgePython?: () => void;
  onReRunHealthCheck?: () => void;
  onOpenSetupAssistant?: () => void;
  /**
   * Toggle the bundled-vs-external Python mode. Persisted via
   * `setGAConfig({ useExternalPython })`. Takes effect on the next
   * bridge spawn - running sessions keep their current Python.
   */
  onToggleExternalPython?: (useExternal: boolean) => void;
  onChangeRuntimeKind?: (kind: RuntimeKind) => void;
  onOpenModels?: () => void;
  /**
   * Commit a manually-typed GA path. Called on Enter / blur when the
   * draft differs from the saved value and validation hasn't returned
   * `not-found`. App-level handler should run the same
   * `setGAConfig({ gaPath })` flow as the folder picker.
   */
  onCommitGAPath?: (path: string) => Promise<void>;
}
