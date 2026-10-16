use super::common::{map_galley_err, origin_from_args};
use super::*;
use crate::api::schedule::{
    mint_scheduled_task_id, CreateScheduledTaskInput, ScheduledTaskBrief, ScheduledTaskPatch,
    ScheduledTaskRepeat,
};
use crate::api::{ScheduledTaskId, ASSISTANT_SUPERVISOR};
use crate::db::ScheduleListScope;
use crate::protocol::{
    ScheduleCreateArgs, ScheduleDeleteArgs, ScheduleDisableArgs, ScheduleEnableArgs,
    ScheduleListArgs, ScheduleRunArgs, ScheduleShowArgs, ScheduleUpdateArgs,
};
use crate::session_writes::Writes;
use crate::subtask_report::SubtaskReports;
use serde::de::DeserializeOwned;

// ---------------- scheduled tasks (main chat ticket 34) ----------------
//
// `galley schedule …`: list, show, create, update, delete (a cancel),
// enable, disable, run. Writes go through Core's write path ([`Writes`]),
// which broadcasts `scheduled-tasks:changed`, like the GUI's Tauri
// commands. Every write records its origin (`--supervisor` / `--reason`);
// a task the assistant makes while a main chat run is open also records
// that run ([`created_in`]).

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
) -> Result<crate::db::SqliteGalley, SocketResponse> {
    ctx.db.get().await.map_err(|e| {
        SocketResponse::err(
            request_id.clone(),
            ErrorTag::DbUnavailable,
            format!("open: {e}"),
        )
    })
}

fn task_result(request_id: Option<String>, task: &ScheduledTaskBrief) -> SocketResponse {
    SocketResponse::ok(request_id, serde_json::json!({ "task": task }))
}

/// An empty value clears a nullable field; absence leaves it alone.
fn clearable(value: Option<String>) -> Option<Option<String>> {
    value.map(|v| {
        let t = v.trim().to_string();
        (!t.is_empty()).then_some(t)
    })
}

/// The main chat run a CLI write comes from, decided deterministically:
/// the write carries the assistant's label (`--supervisor=galley-assistant`)
/// and the main chat has a run open right now — the assistant is the only
/// writer with that label, and a run of the main chat is the only place it
/// acts. Then the main chat and the turn of the user row that started that
/// run. Anything else (no main chat, no run open, another label) records
/// nothing; the task is made all the same. The `todo` family ties a
/// to-do the same way (main chat ticket 40).
pub(super) async fn created_in(
    galley: &crate::db::SqliteGalley,
    ctx: &HandlerCtx<'_>,
    supervisor: Option<&str>,
) -> Option<(SessionId, i64)> {
    if supervisor != Some(ASSISTANT_SUPERVISOR) {
        return None;
    }
    let main = galley.main_chat_id().await.ok().flatten()?;
    if !ctx.runner.run_state(main.as_str()).await.open_run {
        return None;
    }
    let turn = galley
        .latest_user_turn_index(main.as_str())
        .await
        .ok()
        .flatten()?;
    Some((main, turn))
}

pub(super) async fn dispatch_schedule_list(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ScheduleListArgs = match parse(&request_id, args, "schedule.list") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let scope = if parsed.all {
        ScheduleListScope::All
    } else {
        ScheduleListScope::Active
    };
    match galley.list_scheduled_tasks_in(scope).await {
        Ok(tasks) => SocketResponse::ok(request_id, serde_json::json!({ "tasks": tasks })),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_schedule_show(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ScheduleShowArgs = match parse(&request_id, args, "schedule.show") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    match galley.scheduled_task(&parsed.task_id).await {
        Ok(task) => task_result(request_id, &task),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_schedule_create(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ScheduleCreateArgs = match parse(&request_id, args, "schedule.create") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let repeat = match (&parsed.fire_at, parsed.repeat) {
        (Some(_), None) | (Some(_), Some(ScheduledTaskRepeat::Once)) => ScheduledTaskRepeat::Once,
        (None, Some(ScheduledTaskRepeat::Once)) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                "schedule.create: a one-off needs its time (fireAt / --at)",
            )
        }
        (None, Some(repeat)) => repeat,
        (Some(_), Some(_)) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                "schedule.create: give either a one-off time (fireAt / --at) or a repeat rule, \
                 not both",
            )
        }
        (None, None) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                "schedule.create: give a one-off time (fireAt / --at) or a repeat rule \
                 (--daily / --weekly / --monthly with --time)",
            )
        }
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let created_in = created_in(&galley, ctx, parsed.supervisor.as_deref()).await;
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    let input = CreateScheduledTaskInput {
        id: mint_scheduled_task_id(),
        project_id: parsed.project_id,
        prompt: parsed.prompt,
        repeat,
        time_of_day: parsed.time_of_day.unwrap_or_default(),
        llm_name: parsed.llm_name,
        enabled: true,
        fire_at: parsed.fire_at,
        target: parsed.target.unwrap_or_default(),
    };
    match Writes::new(&galley, ctx.notifier.as_ref(), "schedule.create")
        .create_scheduled_task_in(input, origin, created_in)
        .await
    {
        Ok(task) => task_result(request_id, &task),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_schedule_update(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ScheduleUpdateArgs = match parse(&request_id, args, "schedule.update") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    if parsed.fire_at.is_some()
        && parsed
            .repeat
            .as_ref()
            .is_some_and(|r| !matches!(r, ScheduledTaskRepeat::Once))
    {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "schedule.update: give either a one-off time (fireAt / --at) or a repeat rule, not \
             both",
        );
    }
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    let patch = ScheduledTaskPatch {
        project_id: clearable(parsed.project_id),
        prompt: parsed.prompt,
        repeat: parsed.repeat,
        time_of_day: parsed.time_of_day,
        llm_name: clearable(parsed.llm_name),
        enabled: None,
        fire_at: parsed.fire_at,
        target: parsed.target,
    };
    match Writes::new(&galley, ctx.notifier.as_ref(), "schedule.update")
        .update_scheduled_task(ScheduledTaskId(parsed.task_id), patch, origin)
        .await
    {
        Ok(task) => task_result(request_id, &task),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_schedule_delete(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ScheduleDeleteArgs = match parse(&request_id, args, "schedule.delete") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let origin = origin_from_args(parsed.supervisor, parsed.reason);
    let id = ScheduledTaskId(parsed.task_id);
    if let Err(e) = Writes::new(&galley, ctx.notifier.as_ref(), "schedule.delete")
        .delete_scheduled_task(id.clone(), origin)
        .await
    {
        return map_galley_err(request_id, e);
    }
    match galley.scheduled_task(id.as_str()).await {
        Ok(task) => task_result(request_id, &task),
        Err(e) => map_galley_err(request_id, e),
    }
}

async fn set_enabled(
    request_id: Option<String>,
    ctx: &HandlerCtx<'_>,
    task_id: String,
    supervisor: Option<String>,
    reason: Option<String>,
    enabled: bool,
    via: &'static str,
) -> SocketResponse {
    let galley = match open(&request_id, ctx).await {
        Ok(g) => g,
        Err(resp) => return resp,
    };
    let patch = ScheduledTaskPatch {
        enabled: Some(enabled),
        ..ScheduledTaskPatch::default()
    };
    match Writes::new(&galley, ctx.notifier.as_ref(), via)
        .update_scheduled_task(
            ScheduledTaskId(task_id),
            patch,
            origin_from_args(supervisor, reason),
        )
        .await
    {
        Ok(task) => task_result(request_id, &task),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_schedule_enable(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ScheduleEnableArgs = match parse(&request_id, args, "schedule.enable") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    set_enabled(
        request_id,
        ctx,
        parsed.task_id,
        parsed.supervisor,
        parsed.reason,
        true,
        "schedule.enable",
    )
    .await
}

pub(super) async fn dispatch_schedule_disable(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ScheduleDisableArgs = match parse(&request_id, args, "schedule.disable") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    set_enabled(
        request_id,
        ctx,
        parsed.task_id,
        parsed.supervisor,
        parsed.reason,
        false,
        "schedule.disable",
    )
    .await
}

/// "Run now" (the GUI's, issue 13) through the scheduled path
/// ([`crate::scheduler::run_now`]). A `session` task's fire runs the
/// `session.new` handler directly, not this router again.
pub(super) async fn dispatch_schedule_run(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: ScheduleRunArgs = match parse(&request_id, args, "schedule.run") {
        Ok(a) => a,
        Err(resp) => return resp,
    };
    let reports: Option<Arc<SubtaskReports>> = ctx.app.and_then(|app| {
        use tauri::Manager;
        app.try_state::<Arc<SubtaskReports>>()
            .map(|r| r.inner().clone())
    });
    match crate::scheduler::run_now(ctx, reports.as_ref(), &parsed.task_id).await {
        Ok(task) => task_result(request_id, &task),
        Err(e) => map_galley_err(request_id, e),
    }
}
