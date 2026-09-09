use crate::common::{emit_json, probe_live_states, with_live, SCHEMA_VERSION};
use galley_core_lib::api::GalleyApi;
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;

pub(crate) async fn status() -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let s = galley.status().await?;
    // `running` above is the persisted rollup and reads 0 in practice
    // (Core never writes `running` to the status column). `live` is the
    // RunnerManager truth when Core is reachable: how many sessions are
    // busy right now and how many messages sit in outbound queues.
    let live = probe_live_states(None).await.map(|states| {
        let busy = states
            .values()
            .filter(|v| v.get("busy").and_then(|b| b.as_bool()) == Some(true))
            .count();
        let queued: u64 = states
            .values()
            .filter_map(|v| v.get("queuedCount").and_then(|q| q.as_u64()))
            .sum();
        serde_json::json!({ "busy": busy, "queued": queued })
    });
    emit_json(&with_live(&s, live.as_ref())?)?;
    Ok(())
}

pub(crate) async fn health() -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let report = galley.health().await?;
    emit_json(&report)?;
    Ok(())
}

pub(crate) async fn version() -> Result<(), GalleyError> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionPayload<'a> {
        galley_version: &'a str,
        schema_version: u32,
    }
    emit_json(&VersionPayload {
        galley_version: env!("CARGO_PKG_VERSION"),
        schema_version: SCHEMA_VERSION,
    })?;
    Ok(())
}
