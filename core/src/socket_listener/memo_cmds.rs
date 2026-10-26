use super::common::{map_galley_err, origin_from_args};
use super::schedule_cmds::created_in;
use super::*;
use crate::api::{CreateMemoInput, MemoId, MemoPatch};
use crate::protocol::{MemoAddArgs, MemoDeleteArgs, MemoListArgs, MemoUpdateArgs};
use crate::session_writes::Writes;
use serde::de::DeserializeOwned;

// ---------------- memos (main chat ticket 95) ----------------
//
// `galley memo …`: list, add, update, delete. Every write runs the Core
// function behind it (`crate::db::memo`) through Core's write path
// ([`Writes`]), which broadcasts `memos:changed`, like the desktop's
// delete. Core decides the rest: the managed runtime with its main chat
// for any write (`assistant_unavailable:`), a text of 1 to 100
// characters, a last day not before today (`time_in_past:`), the total
// past 2,000 characters said, not refused (`overLimit`). A memo Galley
// writes while a main chat run is open records that run ([`created_in`],
// the schedule family's rule), and a run the user started makes it fresh
// for the next morning review.

fn parse<T: DeserializeOwned>(
    request_id: &Option<String>,
    args: Value,
    name: &str,
) -> Result<T, SocketResponse> {
    serde_json::from_value(args).map_err(|e| {
        SocketResponse::err(
            request_id.clone(),
            ErrorTag::InvalidArgs,
            format!("{name} args: {e}"),
        )
    })
}

async fn open(
    request_id: &Option<String>,
    ctx: &HandlerCtx<'_>,
) -> Result<SqliteGalley, SocketResponse> {
    ctx.db.get().await.map_err(|e| {
        SocketResponse::err(
            request_id.clone(),
            ErrorTag::DbUnavailable,
            format!("open: {e}"),
        )
    })
}

fn ok_json(request_id: Option<String>, value: impl serde::Serialize) -> SocketResponse {
    match serde_json::to_value(value) {
        Ok(value) => SocketResponse::ok(request_id, value),
        Err(e) => SocketResponse::err(request_id, ErrorTag::Internal, format!("encode: {e}")),
    }
}

pub(super) async fn dispatch_memo_list(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let _parsed: MemoListArgs = match parse(&request_id, args, "memo.list") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    match galley.memos_today().await {
        Ok(memos) => SocketResponse::ok(request_id, serde_json::json!({ "memos": memos })),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_memo_add(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: MemoAddArgs = match parse(&request_id, args, "memo.add") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let created_in = created_in(&galley, ctx, parsed.supervisor.as_deref()).await;
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    let input = CreateMemoInput {
        text: parsed.text,
        until: parsed.until,
    };
    match Writes::new(&galley, ctx.notifier.as_ref(), "memo.add")
        .create_memo(input, origin, created_in)
        .await
    {
        Ok(write) => ok_json(request_id, write),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_memo_update(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: MemoUpdateArgs = match parse(&request_id, args, "memo.update") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    // An empty `until` takes the last day off; absence leaves it.
    let until = parsed.until.map(|v| {
        let t = v.trim().to_string();
        (!t.is_empty()).then_some(t)
    });
    let patch = MemoPatch {
        text: parsed.text,
        until,
    };
    if patch.text.is_none() && patch.until.is_none() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "memo.update: nothing to change; give a text or a last day (or none)",
        );
    }
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let created_in = created_in(&galley, ctx, parsed.supervisor.as_deref()).await;
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match Writes::new(&galley, ctx.notifier.as_ref(), "memo.update")
        .update_memo(&MemoId(parsed.memo_id), patch, origin, created_in)
        .await
    {
        Ok(write) => ok_json(request_id, write),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_memo_delete(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: MemoDeleteArgs = match parse(&request_id, args, "memo.delete") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let created_in = created_in(&galley, ctx, parsed.supervisor.as_deref()).await;
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match Writes::new(&galley, ctx.notifier.as_ref(), "memo.delete")
        .delete_memo(&MemoId(parsed.memo_id), origin, created_in)
        .await
    {
        Ok(memo) => SocketResponse::ok(request_id, serde_json::json!({ "memo": memo })),
        Err(e) => map_galley_err(request_id, e),
    }
}
