/**
 * Per-session reasoning effort — the pure half.
 *
 * A session carries a nullable override (`sessions.reasoning_effort`,
 * mirrored on `Session.reasoningEffort`). NULL = follow the selected
 * model's configured tier, which itself may be unset (then the provider
 * decides and no parameter is sent at all).
 *
 *   effective = override ?? configured ?? provider default
 *
 * Three rules live here because the composer pill, the store action and
 * the empty-state pending path must all agree on them:
 *
 *   1. **Override = deviation** (same rule as approval mode, DESIGN
 *      §4.4): picking the tier the model configuration already sets
 *      writes NULL rather than a coincidentally-equal override, so a
 *      switch-and-back round trip leaves zero residue.
 *   2. **The pill shows the effective tier**, and the popover only
 *      offers the `默认` row when the model configuration has no
 *      explicit tier — with an explicit tier there is nothing to
 *      "follow" that isn't already one of the rows. Following vs
 *      deviating is carried by ink, not by a suffix.
 *   3. **The pill does not wait for the bridge.** Before any runner
 *      report, the managed runtime reads the configured tier straight
 *      off the model configuration; the external runtime shows `默认`
 *      until `ready` corrects it. See {@link resolveConfiguredEffort}.
 *
 * The composer deliberately offers a narrower value set than the DB
 * accepts: `none` / `minimal` stay reachable through the model
 * configuration only (both protocols understand the five below —
 * the engine's Claude mapping sends `xhigh` and `max` to the same top
 * tier and only warns-and-ignores `none` / `minimal` — which is what
 * makes the override survive a model switch).
 */

export const COMPOSER_EFFORT_TIERS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ComposerEffortTier = (typeof COMPOSER_EFFORT_TIERS)[number];

/**
 * Every tier the DB / IPC layer accepts. Used to validate what we read
 * out of a model's free-form `advancedOptions` bag.
 */
const EFFORT_VALUES = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/**
 * Sentinel `effortPillState` returns for "the `默认` row is the current
 * one" — i.e. nothing is set anywhere and the provider decides. It is
 * not a wire value and never reaches the store or Core.
 */
export const EFFORT_DEFAULT_ROW = "default";

/**
 * Deviation normalisation — see rule 1 above. `null` (the `默认` row)
 * stays `null`: it *is* "follow the configuration".
 */
export function normalizeEffortOverride(
  picked: string | null,
  configured: string | null,
): string | null {
  if (picked === null) return null;
  return picked === configured ? null : picked;
}

export interface EffortPillState {
  /** Render the leading `默认` row (the model sets no explicit tier). */
  showDefaultRow: boolean;
  /**
   * Which row reads as current: a tier value, {@link EFFORT_DEFAULT_ROW},
   * or null when the effective tier is outside the composer's five (a
   * `none` / `minimal` set in the model configuration) and no row can
   * claim it.
   */
  currentRow: string | null;
  /**
   * True while the session follows its model configuration (no
   * override) — the trigger chip then renders in the quiet ink.
   */
  following: boolean;
}

export function effortPillState({
  override,
  effective,
  configured,
}: {
  override: string | null;
  effective: string | null;
  configured: string | null;
}): EffortPillState {
  const showDefaultRow = configured === null;
  const currentRow =
    effective === null
      ? showDefaultRow
        ? EFFORT_DEFAULT_ROW
        : null
      : effective;
  return {
    showDefaultRow,
    currentRow,
    following: override === null,
  };
}

/** Minimal shape of a managed model record this module needs. */
export interface EffortConfiguredModel {
  id: string;
  advancedOptions: Record<string, unknown>;
}

/**
 * The tier a managed model's configuration carries, or null when it
 * leaves the field empty (provider decides) or holds something outside
 * the accepted value set.
 *
 * No Codex `minimal → medium` coercion here: the runner's own report
 * is the authority on what the engine really does, and it arrives
 * moments later — guessing a coercion would only make the pill flip.
 */
export function modelConfiguredEffort(
  model: EffortConfiguredModel | undefined,
): string | null {
  if (!model) return null;
  const raw = String(model.advancedOptions.reasoning_effort ?? "")
    .trim()
    .toLowerCase();
  return (EFFORT_VALUES as readonly string[]).includes(raw) ? raw : null;
}

/**
 * Resolve the "model configuration value" the pill compares against,
 * without waiting for the bridge (rule 3).
 *
 *   1. A runner report wins whenever one exists — it read the value off
 *      the live backend, which is the ground truth for both runtimes.
 *   2. Managed runtime, no report yet: read the selected model's
 *      configured tier from Galley's own model store. Same source the
 *      spawn will hand the engine, so the pre-`ready` pill is already
 *      right in the common case.
 *   3. External runtime, no report yet: null. Galley cannot see a
 *      user-owned GA's model config (Rule 1), so the pill reads `默认`
 *      until `ready` reports and corrects it.
 */
export function resolveConfiguredEffort({
  known,
  reported,
  runtimeKind,
  selectedModelKey,
  managedModels,
}: {
  /** True once any runner event reported the pair (slot flag). */
  known: boolean;
  /** The slot's `configuredReasoningEffort`. */
  reported: string | null;
  runtimeKind: "managed" | "external";
  /** Stable key of the selected model = the managed model's id. */
  selectedModelKey: string | undefined;
  managedModels: readonly EffortConfiguredModel[];
}): string | null {
  if (known) return reported;
  if (runtimeKind !== "managed" || selectedModelKey === undefined) return null;
  return modelConfiguredEffort(
    managedModels.find((model) => model.id === selectedModelKey),
  );
}
