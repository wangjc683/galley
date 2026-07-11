use crate::client::call_print;
use crate::common::emit_json;
use galley_core_lib::api::GalleyApi;
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::LlmSetArgs;
use serde_json::Value;

/// `llm list` bypasses the socket and reads the cached `llm_list` pref
/// directly. Sub-plan §1.6 chose this path over a socket round-trip so
/// the command stays sub-50ms regardless of bridge spawn cost.
/// `index` is `u32` — guard against bogus pref values by skipping
/// entries that don't parse cleanly.
pub(crate) async fn llm_list() -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let Some(raw) = galley.get_pref_json("llm_list").await? else {
        return Ok(()); // empty stdout, exit 0 — cache unwarmed
    };
    // Expected shape: `[{"index": <u32>, "name": "<str>"}, ...]`. Other
    // shapes mean a future GUI rev changed the schema — print what's
    // there and let the caller notice.
    let arr = match raw {
        Value::Array(xs) => xs,
        other => {
            return Err(GalleyError::InvalidArgs {
                message: format!("pref llm_list is not an array: {}", other),
            });
        }
    };
    for entry in arr {
        emit_json(&entry)?;
    }
    Ok(())
}

pub(crate) async fn llm_set(session_id: String, llm_name: String) -> Result<(), GalleyError> {
    call_print(LlmSetArgs {
        session_id,
        llm_name,
    })
    .await
}
