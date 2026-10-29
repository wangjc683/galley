use super::common::{map_galley_err, origin_from_args};
use super::schedule_cmds::created_in;
use super::*;
use crate::api::{CreateTodoInput, TodoBrief, TodoId, TodoPatch, TodoSubitemId};
use crate::assistant_todo::todo_list;
use crate::protocol::{
    TodoAddArgs, TodoCancelArgs, TodoDoneArgs, TodoListArgs, TodoReopenArgs, TodoShowArgs,
    TodoSubitemAddArgs, TodoSubitemDoneArgs, TodoSubitemMoveArgs, TodoSubitemRemoveArgs,
    TodoSubitemReopenArgs, TodoSubitemUpdateArgs, TodoUpdateArgs,
};
use crate::session_writes::Writes;
use serde::de::DeserializeOwned;

// ---------------- to-dos (main chat ticket 40) ----------------
//
// `galley todo …`: list, show, add, update, done, reopen, cancel. Every
// write runs the Core function behind it (`crate::db::todo`, ticket 39)
// through Core's write path ([`Writes`]), which broadcasts
// `todos:changed` (and `scheduled-tasks:changed` when a reminder may have
// moved), like the desktop's three commands. Core decides the rest: the
// managed runtime with its main chat for any write
// (`assistant_unavailable:`), a reminder time not past (`time_in_past:`),
// the due date's two forms, a reminder cancelled with its to-do. A to-do
// Galley notes while a main chat run is open records that run
// ([`created_in`], the schedule family's rule).
//
// Since main chat ticket 111 the items under a to-do too: `todo item add /
// done / reopen / update / remove` (`todo.item_*`), each answering with
// the to-do as it now stands, items and all, and broadcasting
// `todos:changed`; since ticket 112 `todo item move` (`todo.item_move`).

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

fn todo_result(request_id: Option<String>, todo: &TodoBrief) -> SocketResponse {
    SocketResponse::ok(request_id, serde_json::json!({ "todo": todo }))
}

/// An empty value clears a field (`Some(None)`); a value sets it; absence
/// leaves it alone.
fn clearable(value: Option<String>) -> Option<Option<String>> {
    value.map(|v| {
        let t = v.trim().to_string();
        (!t.is_empty()).then_some(t)
    })
}

pub(super) async fn dispatch_todo_list(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoListArgs = match parse(&request_id, args, "todo.list") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    match todo_list(&galley, parsed.all).await {
        Ok(todos) => SocketResponse::ok(request_id, serde_json::json!({ "todos": todos })),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_todo_show(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoShowArgs = match parse(&request_id, args, "todo.show") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    match galley.todo(&parsed.todo_id).await {
        Ok(todo) => todo_result(request_id, &todo),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_todo_add(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoAddArgs = match parse(&request_id, args, "todo.add") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let created_in = created_in(&galley, ctx, parsed.supervisor.as_deref()).await;
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    let input = CreateTodoInput {
        title: parsed.title,
        notes: parsed.notes,
        due: parsed.due,
        remind_at: parsed.remind_at,
        items: parsed.items,
    };
    match Writes::new(&galley, ctx.notifier.as_ref(), "todo.add")
        .create_todo(input, origin, created_in)
        .await
    {
        Ok(todo) => todo_result(request_id, &todo),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_todo_update(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoUpdateArgs = match parse(&request_id, args, "todo.update") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let patch = TodoPatch {
        title: parsed.title,
        notes: clearable(parsed.notes),
        due: clearable(parsed.due),
        remind_at: clearable(parsed.remind_at),
    };
    if patch.title.is_none()
        && patch.notes.is_none()
        && patch.due.is_none()
        && patch.remind_at.is_none()
    {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "todo.update: nothing to change; give a title, notes, a due date (or none) or a \
             reminder (or none)",
        );
    }
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match Writes::new(&galley, ctx.notifier.as_ref(), "todo.update")
        .update_todo(&TodoId(parsed.todo_id), patch, origin)
        .await
    {
        Ok(todo) => todo_result(request_id, &todo),
        Err(e) => map_galley_err(request_id, e),
    }
}

/// Which of the three state writes.
#[derive(Clone, Copy)]
enum StateWrite {
    Done,
    Reopen,
    Cancel,
}

async fn state_write(
    request_id: Option<String>,
    ctx: &HandlerCtx<'_>,
    todo_id: String,
    supervisor: Option<String>,
    reason: Option<String>,
    write: StateWrite,
) -> SocketResponse {
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(supervisor, reason);
    let id = TodoId(todo_id);
    let result = match write {
        StateWrite::Done => {
            Writes::new(&galley, ctx.notifier.as_ref(), "todo.done")
                .complete_todo(&id, origin)
                .await
        }
        StateWrite::Reopen => {
            Writes::new(&galley, ctx.notifier.as_ref(), "todo.reopen")
                .reopen_todo(&id, origin)
                .await
        }
        StateWrite::Cancel => {
            Writes::new(&galley, ctx.notifier.as_ref(), "todo.cancel")
                .cancel_todo(&id, origin)
                .await
        }
    };
    match result {
        Ok(todo) => todo_result(request_id, &todo),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_todo_done(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoDoneArgs = match parse(&request_id, args, "todo.done") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    state_write(
        request_id,
        ctx,
        parsed.todo_id,
        parsed.supervisor,
        parsed.reason,
        StateWrite::Done,
    )
    .await
}

pub(super) async fn dispatch_todo_reopen(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoReopenArgs = match parse(&request_id, args, "todo.reopen") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    state_write(
        request_id,
        ctx,
        parsed.todo_id,
        parsed.supervisor,
        parsed.reason,
        StateWrite::Reopen,
    )
    .await
}

pub(super) async fn dispatch_todo_cancel(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoCancelArgs = match parse(&request_id, args, "todo.cancel") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    state_write(
        request_id,
        ctx,
        parsed.todo_id,
        parsed.supervisor,
        parsed.reason,
        StateWrite::Cancel,
    )
    .await
}

// ---------------- items under a to-do (main chat ticket 111) ----------------

/// Which of the item writes named by an item's id.
#[derive(Clone, Copy)]
enum SubitemWrite {
    Done,
    Reopen,
    Remove,
}

pub(super) async fn dispatch_todo_item_add(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoSubitemAddArgs = match parse(&request_id, args, "todo.item_add") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match Writes::new(&galley, ctx.notifier.as_ref(), "todo.item_add")
        .add_todo_subitems(&TodoId(parsed.todo_id), &parsed.texts, origin)
        .await
    {
        Ok(todo) => todo_result(request_id, &todo),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_todo_item_update(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoSubitemUpdateArgs = match parse(&request_id, args, "todo.item_update") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match Writes::new(&galley, ctx.notifier.as_ref(), "todo.item_update")
        .update_todo_subitem(&TodoSubitemId(parsed.item_id), &parsed.text, origin)
        .await
    {
        Ok(todo) => todo_result(request_id, &todo),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_todo_item_move(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoSubitemMoveArgs = match parse(&request_id, args, "todo.item_move") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    match Writes::new(&galley, ctx.notifier.as_ref(), "todo.item_move")
        .move_todo_subitem(&TodoSubitemId(parsed.item_id), parsed.to, origin)
        .await
    {
        Ok(todo) => todo_result(request_id, &todo),
        Err(e) => map_galley_err(request_id, e),
    }
}

async fn subitem_write(
    request_id: Option<String>,
    ctx: &HandlerCtx<'_>,
    item_id: String,
    supervisor: Option<String>,
    reason: Option<String>,
    write: SubitemWrite,
) -> SocketResponse {
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(supervisor, reason);
    let id = TodoSubitemId(item_id);
    let result = match write {
        SubitemWrite::Done => {
            Writes::new(&galley, ctx.notifier.as_ref(), "todo.item_done")
                .complete_todo_subitem(&id, origin)
                .await
        }
        SubitemWrite::Reopen => {
            Writes::new(&galley, ctx.notifier.as_ref(), "todo.item_reopen")
                .reopen_todo_subitem(&id, origin)
                .await
        }
        SubitemWrite::Remove => {
            Writes::new(&galley, ctx.notifier.as_ref(), "todo.item_remove")
                .remove_todo_subitem(&id, origin)
                .await
        }
    };
    match result {
        Ok(todo) => todo_result(request_id, &todo),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_todo_item_done(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoSubitemDoneArgs = match parse(&request_id, args, "todo.item_done") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    subitem_write(
        request_id,
        ctx,
        parsed.item_id,
        parsed.supervisor,
        parsed.reason,
        SubitemWrite::Done,
    )
    .await
}

pub(super) async fn dispatch_todo_item_reopen(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoSubitemReopenArgs = match parse(&request_id, args, "todo.item_reopen") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    subitem_write(
        request_id,
        ctx,
        parsed.item_id,
        parsed.supervisor,
        parsed.reason,
        SubitemWrite::Reopen,
    )
    .await
}

pub(super) async fn dispatch_todo_item_remove(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: TodoSubitemRemoveArgs = match parse(&request_id, args, "todo.item_remove") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    subitem_write(
        request_id,
        ctx,
        parsed.item_id,
        parsed.supervisor,
        parsed.reason,
        SubitemWrite::Remove,
    )
    .await
}
