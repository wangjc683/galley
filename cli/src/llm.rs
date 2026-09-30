use crate::args::RuntimeArg;
use crate::client::call_print;
use crate::common::{emit_json, runtime_filter};
use galley_core_lib::api::{GalleyApi, RuntimeKind};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::LlmSetArgs;
use serde::Serialize;
use serde_json::Value;

/// `llm list` bypasses the socket and reads SQLite directly. Sub-plan
/// §1.6 chose this path over a socket round-trip so the command stays
/// sub-50ms regardless of bridge spawn cost. The model list belongs to
/// one runtime: `current` follows the GUI like `sessions list`, and
/// `all` is refused.
pub(crate) async fn llm_list(runtime: RuntimeArg) -> Result<(), GalleyError> {
    // Refuse `all` before opening the DB so the caller mistake is always
    // exit 2, never masked by a db_unavailable exit 4.
    if matches!(runtime, RuntimeArg::All) {
        return Err(runtime_all_refused());
    }
    let galley = SqliteGalley::open().await?;
    match runtime_filter(&galley, runtime).await? {
        Some(RuntimeKind::Managed) => llm_list_managed(&galley).await,
        Some(RuntimeKind::External) => llm_list_external(&galley).await,
        None => Err(runtime_all_refused()),
    }
}

fn runtime_all_refused() -> GalleyError {
    GalleyError::InvalidArgs {
        message: "llm list: --runtime all is not accepted; each runtime has its own model \
                  list, pick current, managed, or external"
            .into(),
    }
}

/// One managed-scope row. Same keys as the entries the GUI caches for
/// external GA, so callers parse one shape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedLlmListRow<'a> {
    index: u32,
    name: &'a str,
    key: &'a str,
    display_name: &'a str,
    is_current: bool,
}

/// Managed scope: the Galley model store, enumerated by the same core
/// function the `llm.set` / `session.new --llm` resolver matches against
/// (`SqliteGalley::list_managed_llm_choices`), so every printed `name`
/// resolves. `isCurrent` marks index 0 — the model a managed runtime
/// started without a model pick uses. An empty store is empty output,
/// exit 0.
async fn llm_list_managed(galley: &SqliteGalley) -> Result<(), GalleyError> {
    for choice in galley.list_managed_llm_choices().await? {
        emit_json(&ManagedLlmListRow {
            index: choice.index,
            name: &choice.display_name,
            key: &choice.key,
            display_name: &choice.display_name,
            is_current: choice.index == 0,
        })?;
    }
    Ok(())
}

/// External scope: the cached `llm_list` pref the GUI writes after an
/// external-GA bridge warmup, printed as stored.
/// `index` is `u32` — guard against bogus pref values by skipping
/// entries that don't parse cleanly.
async fn llm_list_external(galley: &SqliteGalley) -> Result<(), GalleyError> {
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
