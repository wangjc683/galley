//! Layered managed model advanced options.
//!
//! A managed model's advanced options are three objects merged in order:
//!
//! ```text
//! effective = preset_options ⊕ defaults ⊕ advanced_overrides
//! ```
//!
//! * `preset_options` — the row's baseline, written at creation from the
//!   provider preset (protocol-dialect keys, engine tuning the GUI never
//!   edits, the preset's own values for the layered keys).
//! * `defaults` — one user-owned object for every model, stored under
//!   [`DEFAULTS_PREF_KEY`]. Restricted to the six [`DEFAULT_KEYS`]; anything
//!   else is dropped on write.
//! * `advanced_overrides` — the model's own deviations. A JSON `null` is a
//!   tombstone: the key is removed from the effective object ("unset, do
//!   not send"), which is how one model opts out of a defaults-layer
//!   `reasoning_effort` on an endpoint that rejects the field.
//!
//! The per-session `reasoning_effort` override (migration 040) sits above
//! all three and is applied by the runner, not here. The GUI mirrors the
//! key list and the merge in `gui/src/lib/managed-model-layers.ts`; this
//! module is the authority.

use serde_json::{Map, Value};

use crate::error::{GalleyError, Result};

/// prefs key holding the defaults layer.
pub const DEFAULTS_PREF_KEY: &str = "managed_model_defaults";

/// The keys the defaults layer may carry. Protocol-agnostic by
/// construction: `api_mode` / `thinking_type` / `fake_cc_system_prompt`
/// are endpoint dialect and stay preset- or model-level (a global
/// `api_mode` would break the Codex backend, a global
/// `fake_cc_system_prompt` would break every non-Kimi endpoint).
pub const DEFAULT_KEYS: [&str; 6] = [
    "max_retries",
    "read_timeout",
    "max_retry_after",
    "trim_keep_prefix",
    "stream",
    "reasoning_effort",
];

/// Reasoning tiers the defaults layer accepts: the ones both engine
/// protocol paths understand (`llmcore.py` maps `xhigh` and `max` to
/// Claude's `output_config.effort: max`; it warns and ignores `none` /
/// `minimal` there, and the Codex backend coerces `minimal` to `medium`).
pub const DEFAULTS_REASONING_TIERS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// `preset ⊕ defaults ⊕ overrides`. Non-object inputs count as `{}`.
pub fn effective_advanced_options(preset: &Value, defaults: &Value, overrides: &Value) -> Value {
    let mut merged: Map<String, Value> = Map::new();
    for layer in [preset, defaults] {
        if let Value::Object(map) = layer {
            for (key, value) in map {
                merged.insert(key.clone(), value.clone());
            }
        }
    }
    if let Value::Object(map) = overrides {
        for (key, value) in map {
            if value.is_null() {
                merged.remove(key);
            } else {
                merged.insert(key.clone(), value.clone());
            }
        }
    }
    Value::Object(merged)
}

/// Validate and filter a defaults object for storage: only
/// [`DEFAULT_KEYS`] survive, each with its expected type. A `null` or
/// absent key means "recommended" and is dropped rather than stored (the
/// defaults layer has no tombstones — there is nothing below it to hide).
pub fn normalize_defaults(input: &Value) -> Result<Value> {
    let Value::Object(map) = input else {
        return Err(GalleyError::InvalidArgs {
            message: "managed model defaults must be a JSON object".into(),
        });
    };
    let mut out = Map::new();
    for key in DEFAULT_KEYS {
        let Some(value) = map.get(key) else {
            continue;
        };
        if value.is_null() {
            continue;
        }
        let valid = match key {
            "stream" => value.is_boolean(),
            "reasoning_effort" => value
                .as_str()
                .is_some_and(|tier| DEFAULTS_REASONING_TIERS.contains(&tier)),
            // max_retries / read_timeout / max_retry_after / trim_keep_prefix
            _ => value.as_u64().is_some(),
        };
        if !valid {
            return Err(GalleyError::InvalidArgs {
                message: format!("managed model defaults: invalid value for {key}: {value}"),
            });
        }
        out.insert(key.to_string(), value.clone());
    }
    Ok(Value::Object(out))
}

/// Overrides must be an object; values are free-form (dialect keys can be
/// overridden too) and `null` tombstones are allowed.
pub fn normalize_overrides(input: Option<Value>) -> Result<Value> {
    match input {
        None => Ok(Value::Object(Map::new())),
        Some(value @ Value::Object(_)) => Ok(value),
        Some(other) => Err(GalleyError::InvalidArgs {
            message: format!("managed model advancedOverrides must be a JSON object, got {other}"),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn effective_merges_in_layer_order() {
        let preset =
            json!({"api_mode": "responses", "read_timeout": 180, "reasoning_effort": "high"});
        let defaults = json!({"read_timeout": 300, "reasoning_effort": "medium"});
        let overrides = json!({"read_timeout": 42});
        assert_eq!(
            effective_advanced_options(&preset, &defaults, &overrides),
            json!({"api_mode": "responses", "read_timeout": 42, "reasoning_effort": "medium"})
        );
    }

    #[test]
    fn null_override_is_a_tombstone() {
        let preset = json!({"reasoning_effort": "high", "stream": true});
        let defaults = json!({"reasoning_effort": "medium"});
        let overrides = json!({"reasoning_effort": null});
        assert_eq!(
            effective_advanced_options(&preset, &defaults, &overrides),
            json!({"stream": true})
        );
    }

    #[test]
    fn non_object_layers_are_empty() {
        assert_eq!(
            effective_advanced_options(&json!([]), &json!("x"), &json!({"a": 1})),
            json!({"a": 1})
        );
    }

    #[test]
    fn normalize_defaults_keeps_only_layered_keys() {
        let out = normalize_defaults(&json!({
            "read_timeout": 300,
            "stream": false,
            "reasoning_effort": "max",
            "api_mode": "responses",
            "max_retry_after": null
        }))
        .unwrap();
        assert_eq!(
            out,
            json!({"read_timeout": 300, "stream": false, "reasoning_effort": "max"})
        );
    }

    #[test]
    fn normalize_defaults_rejects_wrong_types_and_tiers() {
        assert!(normalize_defaults(&json!({"read_timeout": -1})).is_err());
        assert!(normalize_defaults(&json!({"read_timeout": "300"})).is_err());
        assert!(normalize_defaults(&json!({"stream": 1})).is_err());
        assert!(normalize_defaults(&json!({"reasoning_effort": "minimal"})).is_err());
        assert!(normalize_defaults(&json!([])).is_err());
    }

    #[test]
    fn normalize_overrides_accepts_object_or_absent() {
        assert_eq!(normalize_overrides(None).unwrap(), json!({}));
        assert_eq!(
            normalize_overrides(Some(json!({"stream": null}))).unwrap(),
            json!({"stream": null})
        );
        assert!(normalize_overrides(Some(json!(1))).is_err());
    }
}
