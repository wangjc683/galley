use std::collections::BTreeMap;
use std::time::Duration;

use crate::client::{call_print, client, next_watch_frame_strict};
use crate::common::{emit_json, is_live_candidate, StreamEndPayload, SCHEMA_VERSION};
use galley_core_lib::api::{
    GalleyApi, MessageBrief, ProjectBrief, SessionBrief, SessionFilter, SessionStatus,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{ProjectCreateArgs, ProjectDeleteArgs, WatchFrame};
use serde::Serialize;
use serde_json::Value;

const PROJECT_FOLLOW_IDLE_QUIET_WINDOW: Duration = Duration::from_millis(1500);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRollupPayload {
    schema_version: u32,
    project: ProjectBrief,
    session_count: usize,
    status_counts: BTreeMap<String, usize>,
    running_sessions: Vec<SessionBrief>,
    last_activity_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSessionDetail {
    session: SessionBrief,
    messages: Vec<MessageBrief>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectShowPayload {
    schema_version: u32,
    project: ProjectBrief,
    session_count: usize,
    status_counts: BTreeMap<String, usize>,
    sessions: Vec<ProjectSessionDetail>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFollowState {
    mode: &'static str,
    state: &'static str,
    watched_sessions: usize,
    active_status_sessions: usize,
    idle_status_sessions: usize,
    note: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshotPayload {
    schema_version: u32,
    stream: &'static str,
    phase: &'static str,
    project: ProjectBrief,
    session_count: usize,
    status_counts: BTreeMap<String, usize>,
    sessions: Vec<ProjectSessionDetail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    follow_state: Option<ProjectFollowState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEventPayload {
    schema_version: u32,
    stream: &'static str,
    session_id: String,
    data: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSessionEndPayload {
    schema_version: u32,
    stream: &'static str,
    session_id: String,
    reason: String,
}

async fn find_project(
    galley: &SqliteGalley,
    project_id: &str,
) -> Result<ProjectBrief, GalleyError> {
    galley
        .list_projects()
        .await?
        .into_iter()
        .find(|p| p.id.as_str() == project_id)
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("project {project_id} not found"),
        })
}

async fn project_sessions(
    galley: &SqliteGalley,
    project_id: &str,
    all: bool,
    scope: Option<&[String]>,
) -> Result<Vec<SessionBrief>, GalleyError> {
    let mut sessions = galley
        .list_sessions(SessionFilter {
            project_id: Some(project_id.to_string()),
            status: None,
            archived: if all { None } else { Some(false) },
            runtime_kind: None,
        })
        .await?;
    if let Some(scope) = scope {
        sessions.retain(|session| scope.iter().any(|id| id == session.id.as_str()));
    }
    Ok(sessions)
}

fn status_key(status: SessionStatus) -> &'static str {
    match status {
        SessionStatus::Idle => "idle",
        SessionStatus::Connecting => "connecting",
        SessionStatus::Running => "running",
        SessionStatus::WaitingApproval => "waiting_approval",
        SessionStatus::Error => "error",
        SessionStatus::Completed => "completed",
        SessionStatus::Cancelled => "cancelled",
        SessionStatus::Archived => "archived",
    }
}

fn status_counts(sessions: &[SessionBrief]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for s in sessions {
        *counts.entry(status_key(s.status).to_string()).or_insert(0) += 1;
    }
    counts
}

fn project_follow_state(
    mode: &'static str,
    sessions: &[ProjectSessionDetail],
) -> ProjectFollowState {
    let active_status_sessions = sessions
        .iter()
        .filter(|detail| is_live_candidate(detail.session.status))
        .count();
    let idle_status_sessions = sessions
        .iter()
        .filter(|detail| detail.session.status == SessionStatus::Idle)
        .count();
    let (state, note) = if sessions.is_empty() {
        ("empty_project", "project has no sessions to follow")
    } else if active_status_sessions == 0 {
        (
            "checking_live_events",
            "no session is marked active yet; following all project sessions before declaring the batch idle",
        )
    } else {
        (
            "active_status_sessions",
            "one or more sessions are marked active; following project live events",
        )
    };
    ProjectFollowState {
        mode,
        state,
        watched_sessions: sessions.len(),
        active_status_sessions,
        idle_status_sessions,
        note,
    }
}

async fn project_has_active_sessions(
    project_id: &str,
    all: bool,
    scope: Option<&[String]>,
) -> Result<bool, GalleyError> {
    let galley = SqliteGalley::open().await?;
    let sessions = project_sessions(&galley, project_id, all, scope).await?;
    Ok(sessions
        .iter()
        .any(|session| is_live_candidate(session.status)))
}

async fn project_rollup_payload(
    galley: &SqliteGalley,
    project_id: &str,
    all: bool,
) -> Result<ProjectRollupPayload, GalleyError> {
    let project = find_project(galley, project_id).await?;
    let sessions = project_sessions(galley, project_id, all, None).await?;
    let running_sessions = sessions
        .iter()
        .filter(|s| s.status == SessionStatus::Running)
        .cloned()
        .collect::<Vec<_>>();
    Ok(ProjectRollupPayload {
        schema_version: SCHEMA_VERSION,
        last_activity_at: project.last_activity_at.clone(),
        project,
        session_count: sessions.len(),
        status_counts: status_counts(&sessions),
        running_sessions,
    })
}

async fn project_session_details(
    galley: &SqliteGalley,
    sessions: &[SessionBrief],
    tail: usize,
) -> Result<Vec<ProjectSessionDetail>, GalleyError> {
    let mut details = Vec::with_capacity(sessions.len());
    for session in sessions {
        let messages = galley
            .session_messages(session.id.clone(), Some(tail))
            .await?;
        details.push(ProjectSessionDetail {
            session: session.clone(),
            messages,
        });
    }
    Ok(details)
}

async fn project_show_payload(
    galley: &SqliteGalley,
    project_id: &str,
    tail: usize,
    all: bool,
    scope: Option<&[String]>,
) -> Result<ProjectShowPayload, GalleyError> {
    let project = find_project(galley, project_id).await?;
    let sessions = project_sessions(galley, project_id, all, scope).await?;
    let status_counts = status_counts(&sessions);
    let session_count = sessions.len();
    let details = project_session_details(galley, &sessions, tail).await?;
    Ok(ProjectShowPayload {
        schema_version: SCHEMA_VERSION,
        project,
        session_count,
        status_counts,
        sessions: details,
    })
}

async fn project_snapshot_payload(
    galley: &SqliteGalley,
    project_id: &str,
    phase: &'static str,
    tail: usize,
    all: bool,
    scope: Option<&[String]>,
) -> Result<ProjectSnapshotPayload, GalleyError> {
    let show = project_show_payload(galley, project_id, tail, all, scope).await?;
    Ok(ProjectSnapshotPayload {
        schema_version: SCHEMA_VERSION,
        stream: "snapshot",
        phase,
        project: show.project,
        session_count: show.session_count,
        status_counts: show.status_counts,
        sessions: show.sessions,
        follow_state: None,
    })
}

pub(crate) async fn project_create(
    name: String,
    root_path: Option<String>,
    enable_workspace: bool,
    icon: Option<String>,
    color: Option<String>,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    if enable_workspace
        && root_path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .is_none()
    {
        return Err(GalleyError::InvalidArgs {
            message: "--enable-workspace requires --root-path".into(),
        });
    }
    call_print(ProjectCreateArgs {
        name,
        root_path,
        workspace_enabled: enable_workspace,
        icon,
        color,
        supervisor,
        reason,
    })
    .await
}

/// `project list` bypasses the socket and opens SQLite directly —
/// inventory-style read, mirror of `sessions list`. Works even when
/// Galley Core isn't running.
pub(crate) async fn project_list() -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let projects = galley.list_projects().await?;
    for p in projects {
        emit_json(&p)?;
    }
    Ok(())
}

pub(crate) async fn project_brief(project_id: String, all: bool) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    emit_json(&project_rollup_payload(&galley, &project_id, all).await?)?;
    Ok(())
}

pub(crate) async fn project_show(
    project_id: String,
    tail: usize,
    all: bool,
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    emit_json(&project_show_payload(&galley, &project_id, tail, all, None).await?)?;
    Ok(())
}

enum ProjectWatchItem {
    Event { session_id: String, data: Value },
    End { session_id: String, reason: String },
    Error(GalleyError),
}

async fn forward_project_watch(
    session_id: String,
    report_initial_failure: bool,
    tx: tokio::sync::mpsc::UnboundedSender<ProjectWatchItem>,
) {
    let mut lines = match client().open_watch(&session_id).await {
        Ok(lines) => lines,
        Err(GalleyError::DbUnavailable { .. }) => {
            if report_initial_failure {
                let _ = tx.send(ProjectWatchItem::End {
                    session_id,
                    reason: "core_unavailable".into(),
                });
            }
            return;
        }
        Err(e) => {
            let _ = tx.send(ProjectWatchItem::Error(e));
            return;
        }
    };

    loop {
        match next_watch_frame_strict(&mut lines).await {
            Ok(Some(WatchFrame::Event(data))) => {
                if tx
                    .send(ProjectWatchItem::Event {
                        session_id: session_id.clone(),
                        data,
                    })
                    .is_err()
                {
                    return;
                }
            }
            Ok(Some(WatchFrame::End(reason))) => {
                let _ = tx.send(ProjectWatchItem::End { session_id, reason });
                return;
            }
            Ok(Some(WatchFrame::Error { .. } | WatchFrame::Unparseable(_))) => {
                unreachable!("next_watch_frame_strict surfaces these as Err")
            }
            Ok(None) => {
                let _ = tx.send(ProjectWatchItem::End {
                    session_id,
                    reason: "socket_closed".into(),
                });
                return;
            }
            Err(GalleyError::NotFound { .. }) => {
                if report_initial_failure {
                    let _ = tx.send(ProjectWatchItem::End {
                        session_id,
                        reason: "not_live".into(),
                    });
                }
                return;
            }
            Err(e) => {
                let _ = tx.send(ProjectWatchItem::Error(e));
                return;
            }
        }
    }
}

fn emit_project_watch_item(item: ProjectWatchItem) -> Result<(), GalleyError> {
    match item {
        ProjectWatchItem::Event { session_id, data } => emit_json(&ProjectEventPayload {
            schema_version: SCHEMA_VERSION,
            stream: "event",
            session_id,
            data,
        }),
        ProjectWatchItem::End { session_id, reason } => emit_json(&ProjectSessionEndPayload {
            schema_version: SCHEMA_VERSION,
            stream: "sessionEnd",
            session_id,
            reason,
        }),
        ProjectWatchItem::Error(e) => Err(e),
    }
}

async fn emit_project_final_snapshot(
    project_id: &str,
    tail: usize,
    all: bool,
    mode: &'static str,
    scope: Option<&[String]>,
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let mut final_snapshot =
        project_snapshot_payload(&galley, project_id, "final", tail, all, scope).await?;
    final_snapshot.follow_state = Some(project_follow_state(mode, &final_snapshot.sessions));
    emit_json(&final_snapshot)
}

async fn project_follow_until_idle(
    project_id: String,
    tail: usize,
    all: bool,
    final_show: bool,
    scope: Option<Vec<String>>,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<ProjectWatchItem>,
) -> Result<(), GalleyError> {
    let mut saw_stream_item = false;
    let mut quiet_window = Box::pin(tokio::time::sleep(PROJECT_FOLLOW_IDLE_QUIET_WINDOW));

    loop {
        tokio::select! {
            item = rx.recv() => {
                match item {
                    Some(item) => {
                        saw_stream_item = true;
                        emit_project_watch_item(item)?;
                        quiet_window.as_mut().reset(
                            tokio::time::Instant::now() + PROJECT_FOLLOW_IDLE_QUIET_WINDOW,
                        );
                    }
                    None => {
                        if !saw_stream_item {
                            tokio::time::sleep(PROJECT_FOLLOW_IDLE_QUIET_WINDOW).await;
                        }
                        if final_show || saw_stream_item {
                            emit_project_final_snapshot(
                                &project_id,
                                tail,
                                all,
                                "until_idle",
                                scope.as_deref(),
                            )
                            .await?;
                        }
                        emit_json(&StreamEndPayload {
                            schema_version: SCHEMA_VERSION,
                            stream: "end",
                            reason: if saw_stream_item {
                                "all_live_sessions_ended"
                            } else {
                                "no_live_sessions"
                            },
                        })?;
                        return Ok(());
                    }
                }
            }
            _ = &mut quiet_window => {
                if !project_has_active_sessions(&project_id, all, scope.as_deref()).await? {
                    if final_show {
                        emit_project_final_snapshot(
                            &project_id,
                            tail,
                            all,
                            "until_idle",
                            scope.as_deref(),
                        )
                        .await?;
                    }
                    emit_json(&StreamEndPayload {
                        schema_version: SCHEMA_VERSION,
                        stream: "end",
                        reason: "project_idle",
                    })?;
                    return Ok(());
                }
                quiet_window.as_mut().reset(
                    tokio::time::Instant::now() + PROJECT_FOLLOW_IDLE_QUIET_WINDOW,
                );
            }
        }
    }
}

/// `only_sessions` restricts the follow to those session ids (watch
/// targets, idle detection, and snapshots). The goal controller passes
/// its master + worker sessions so user chatter in unrelated sessions
/// of the same project cannot reset the until-idle quiet window.
pub(crate) async fn project_follow(
    project_id: String,
    tail: usize,
    all: bool,
    until_idle: bool,
    final_show: bool,
    only_sessions: Option<Vec<String>>,
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let scope = only_sessions;
    let mut initial =
        project_snapshot_payload(&galley, &project_id, "initial", tail, all, scope.as_deref())
            .await?;
    let mode = if until_idle { "until_idle" } else { "live" };
    let watch_targets = initial
        .sessions
        .iter()
        .map(|detail| {
            (
                detail.session.id.0.clone(),
                is_live_candidate(detail.session.status),
            )
        })
        .collect::<Vec<_>>();
    initial.follow_state = Some(project_follow_state(mode, &initial.sessions));
    emit_json(&initial)?;

    if watch_targets.is_empty() {
        if final_show {
            emit_project_final_snapshot(&project_id, tail, all, mode, scope.as_deref()).await?;
        }
        emit_json(&StreamEndPayload {
            schema_version: SCHEMA_VERSION,
            stream: "end",
            reason: "no_live_sessions",
        })?;
        return Ok(());
    }

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    for (session_id, report_initial_failure) in watch_targets {
        let tx = tx.clone();
        tokio::spawn(forward_project_watch(
            session_id,
            report_initial_failure,
            tx,
        ));
    }
    drop(tx);

    if until_idle {
        return project_follow_until_idle(project_id, tail, all, final_show, scope, rx).await;
    }

    let mut saw_stream_item = false;
    while let Some(item) = rx.recv().await {
        saw_stream_item = true;
        emit_project_watch_item(item)?;
    }

    if !saw_stream_item {
        if final_show {
            emit_project_final_snapshot(&project_id, tail, all, mode, scope.as_deref()).await?;
        }
        emit_json(&StreamEndPayload {
            schema_version: SCHEMA_VERSION,
            stream: "end",
            reason: "no_live_sessions",
        })?;
        return Ok(());
    }

    emit_project_final_snapshot(&project_id, tail, all, mode, scope.as_deref()).await?;
    emit_json(&StreamEndPayload {
        schema_version: SCHEMA_VERSION,
        stream: "end",
        reason: "all_live_sessions_ended",
    })?;
    Ok(())
}

pub(crate) async fn project_delete(
    project_id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(ProjectDeleteArgs {
        project_id,
        supervisor,
        reason,
    })
    .await
}
