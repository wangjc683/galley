/**
 * Layered model advanced configuration — the pure half.
 *
 * A model's effective options are merged from three layers plus the
 * per-session reasoning-effort override that ships separately:
 *
 *   effective = presetOptions ⊕ defaults ⊕ advancedOverrides
 *
 *   - `presetOptions` — per model, written at creation from the
 *     provider preset. Protocol-dialect keys (`api_mode`,
 *     `thinking_type`, `fake_cc_system_prompt`, `codex_backend`),
 *     non-UI keys (`context_win`, `temperature`, `connect_timeout`)
 *     and the preset's own values for the layered keys. Never edited
 *     directly.
 *   - `defaults` — one global object (Settings → 模型 → 默认高级配置),
 *     holding only the user's deviations from the factory recommended
 *     values below. `{}` = all recommended.
 *   - `advancedOverrides` — per model, only the keys where this model
 *     deviates from its baseline (`presetOptions` ⊕ `defaults`). A
 *     JSON `null` is a tombstone: unset the key entirely, do not send
 *     it (this is 「不设置，由服务商决定」 for `reasoning_effort`).
 *
 * Deviation rule, both at the model layer and the defaults layer:
 * writing the value the layer below already produces DELETES the key,
 * so a switch-and-back round trip leaves zero residue. This replaces
 * the old per-key sentinels (`trim_keep_prefix` 0, `max_retry_after`
 * 60), which are now legitimate model-layer overrides.
 */

/**
 * The six keys the defaults layer may hold. Core's
 * `managed_model_layers.rs` owns this list and enforces it; this is a
 * mirror so the GUI never offers a key Core would drop.
 */
export const MANAGED_MODEL_DEFAULT_KEYS = [
  "max_retries",
  "read_timeout",
  "max_retry_after",
  "trim_keep_prefix",
  "stream",
  "reasoning_effort",
] as const;

export type ManagedModelDefaultKey =
  (typeof MANAGED_MODEL_DEFAULT_KEYS)[number];

/**
 * Reasoning tiers offered at the DEFAULTS layer. `none` / `minimal`
 * are deliberately absent: they are protocol- and backend-specific
 * (the Claude path warns and ignores them, Codex OAuth has no
 * `minimal`), so they stay reachable per model only.
 */
export const DEFAULTS_REASONING_TIERS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/**
 * The recommended values the defaults panel shows when the stored
 * defaults object says nothing. `reasoning_effort` is deliberately
 * absent — unset means "由服务商决定".
 */
export const FACTORY_MODEL_DEFAULTS: Record<string, unknown> = {
  max_retries: 3,
  read_timeout: 180,
  max_retry_after: 60,
  trim_keep_prefix: 0,
  stream: true,
};

/** Merge the three layers. A `null` in `overrides` is a tombstone and
 * removes the key rather than sending a null downstream. */
export function effectiveAdvancedOptions(
  preset: Record<string, unknown>,
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...preset, ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

/**
 * What a model inherits when it overrides nothing — the value every
 * model-layer deviation is measured against. The factory values sit
 * underneath so a key neither layer sets (typically `max_retry_after`
 * / `trim_keep_prefix`) still has a baseline equal to what the field
 * displays: typing the displayed value back must not leave an
 * override behind. The factory values ARE the engine's own defaults
 * for those keys, so the effective object (which never includes them)
 * runs the same either way.
 */
export function modelLayerBaseline(
  preset: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  return { ...FACTORY_MODEL_DEFAULTS, ...preset, ...defaults };
}

/**
 * Apply one model-layer edit under the deviation rule.
 *
 *   - value equal to the baseline's → delete the key (follow again)
 *   - `null` → tombstone, but only when the baseline actually sets the
 *     key; with nothing to unset, "不设置" IS "跟随默认", so store
 *     nothing
 *   - anything else → store the deviation
 */
export function withLayeredOverride(
  overrides: Record<string, unknown>,
  baseline: Record<string, unknown>,
  key: string,
  value: string | number | boolean | null,
): Record<string, unknown> {
  const next = { ...overrides };
  if (value === null) {
    if (baseline[key] === undefined) {
      delete next[key];
    } else {
      next[key] = null;
    }
    return next;
  }
  if (baseline[key] === value) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

/** How many of the given UI keys this model overrides. Tombstones
 * count — "不设置" is a deviation from an inherited tier. */
export function overrideCount(
  overrides: Record<string, unknown>,
  keys: readonly string[],
): number {
  return keys.filter((key) => key in overrides).length;
}

/** Apply one defaults-layer edit. Equal to the factory value (or
 * unset / empty) deletes the key, so the stored object stays a pure
 * deviation list. */
export function withDefaultsOption(
  defaults: Record<string, unknown>,
  key: string,
  value: string | number | boolean | null,
): Record<string, unknown> {
  const next = { ...defaults };
  if (value === null || value === "" || FACTORY_MODEL_DEFAULTS[key] === value) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

/** The 「N 项已自定义」 counter: every key the stored defaults hold. */
export function defaultsCustomCount(defaults: Record<string, unknown>): number {
  return Object.keys(defaults).length;
}

/** Can 「设为所有模型的默认」 do anything with these overrides? */
export function hasPromotableOverrides(
  overrides: Record<string, unknown>,
): boolean {
  return MANAGED_MODEL_DEFAULT_KEYS.some((key) => isPromotable(overrides, key));
}

/**
 * Move this model's layered overrides into the global defaults:
 * 「设为所有模型的默认」. Tombstones stay put (the defaults layer has
 * no way to express "unset"), and a `reasoning_effort` outside
 * {@link DEFAULTS_REASONING_TIERS} stays put too. Everything moved is
 * removed from the overrides, so the model ends up following the very
 * defaults it just wrote.
 */
export function promoteOverridesToDefaults(
  overrides: Record<string, unknown>,
  defaults: Record<string, unknown>,
): { defaults: Record<string, unknown>; overrides: Record<string, unknown> } {
  let nextDefaults = { ...defaults };
  const nextOverrides = { ...overrides };
  for (const key of MANAGED_MODEL_DEFAULT_KEYS) {
    if (!isPromotable(nextOverrides, key)) continue;
    nextDefaults = withDefaultsOption(
      nextDefaults,
      key,
      nextOverrides[key] as string | number | boolean,
    );
    delete nextOverrides[key];
  }
  return { defaults: nextDefaults, overrides: nextOverrides };
}

function isPromotable(
  overrides: Record<string, unknown>,
  key: ManagedModelDefaultKey,
): boolean {
  const value = overrides[key];
  if (value === undefined || value === null) return false;
  if (key === "reasoning_effort") {
    return (DEFAULTS_REASONING_TIERS as readonly string[]).includes(
      String(value),
    );
  }
  return true;
}
