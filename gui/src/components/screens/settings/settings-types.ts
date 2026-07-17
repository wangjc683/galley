export type SettingsTab =
  | "general"
  | "runtime"
  | "models"
  | "approval"
  | "integration"
  | "im"
  | "browser"
  | "shortcuts"
  | "about";

export interface ApprovalConfig {
  /** Tools that require approval before dispatch. */
  requiredTools: string[];
  /** Per-project always-allow rules (current project). */
  alwaysAllowProject: string[];
  /** Global always-allow rules. */
  alwaysAllowGlobal: string[];
}
