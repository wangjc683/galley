use std::collections::{BTreeMap, HashMap};
use std::time::Duration;

use crate::client::{call_print, client, next_watch_frame_strict};
use crate::common::{
    emit_json, is_live_candidate, live_run_ended, probe_live_states, StreamEndPayload,
    SCHEMA_VERSION,
};
use galley_core_lib::api::{
    GalleyApi, MessageBrief, ProjectBrief, SessionBrief, SessionFilter, SessionStatus,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{ProjectCreateArgs, ProjectDeleteArgs, WatchFrame};
use serde::Serialize;
use serde_json::Value;

/// `--until-idle` asks Galley Core whether any session still has a run
/// open or in progress only after this long without an event.
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
) -> Result<Vec<SessionBrief>, GalleyError> {
    galley
        .list_sessions(SessionFilter {
            project_id: Some(project_id.to_string()),
            status: None,
            archived: if all { None } else { Some(false) },
            runtime_kind: None,
        })
        .await
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

/// Galley Core's live run state (`sessions.run_state`) per session id.
type LiveStates = HashMap<String, Value>;

/// One best-effort live probe for these sessions; `None` when Galley Core
/// is unreachable, and the callers then read the persisted status.
async fn probe_project_live(ids: Vec<String>) -> Option<LiveStates> {
    if ids.is_empty() {
        return Some(LiveStates::new());
    }
    probe_live_states(Some(ids)).await
}

fn detail_ids(details: &[ProjectSessionDetail]) -> Vec<String> {
    details
        .iter()
        .map(|detail| detail.session.id.0.clone())
        .collect()
}

/// Whether a project session has a run open or in progress. With Galley
/// Core reachable that is its live run state, by the rule `session wait
/// --until-idle` uses ([`live_run_ended`]); Core answers for every id it
/// is asked about, so a missing entry means no run. The persisted status
/// never shows a run (Core writes only `idle` / `archived`), so it is
/// only the fallback for an unreachable Core.
fn session_active(session: &SessionBrief, live: Option<&LiveStates>) -> bool {
    match live {
        Some(states) => states
            .get(&session.id.0)
            .is_some_and(|state| !live_run_ended(state)),
        None => is_live_candidate(session.status),
    }
}

fn project_follow_state(
    mode: &'static str,
    sessions: &[ProjectSessionDetail],
    live: Option<&LiveStates>,
) -> ProjectFollowState {
    let active_status_sessions = sessions
        .iter()
        .filter(|detail| session_active(&detail.session, live))
        .count();
    let idle_status_sessions = sessions
        .iter()
        .filter(|detail| {
            detail.session.status == SessionStatus::Idle && !session_active(&detail.session, live)
        })
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

async fn project_has_active_sessions(project_id: &str, all: bool) -> Result<bool, GalleyError> {
    let galley = SqliteGalley::open().await?;
    let sessions = project_sessions(&galley, project_id, all).await?;
    let live = probe_project_live(sessions.iter().map(|s| s.id.0.clone()).collect()).await;
    Ok(sessions
        .iter()
        .any(|session| session_active(session, live.as_ref())))
}

async fn project_rollup_payload(
    galley: &SqliteGalley,
    project_id: &str,
    all: bool,
) -> Result<ProjectRollupPayload, GalleyError> {
    let project = find_project(galley, project_id).await?;
    let sessions = project_sessions(galley, project_id, all).await?;
    let live = probe_project_live(sessions.iter().map(|s| s.id.0.clone()).collect()).await;
    let running_sessions = sessions
        .iter()
        .filter(|s| match &live {
            Some(states) => session_active(s, Some(states)),
            // Core unreachable: the persisted status, as before.
            None => s.status == SessionStatus::Running,
        })
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
) -> Result<ProjectShowPayload, GalleyError> {
    let project = find_project(galley, project_id).await?;
    let sessions = project_sessions(galley, project_id, all).await?;
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
) -> Result<ProjectSnapshotPayload, GalleyError> {
    let show = project_show_payload(galley, project_id, tail, all).await?;
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
    emit_json(&project_show_payload(&galley, &project_id, tail, all).await?)?;
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
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let mut final_snapshot =
        project_snapshot_payload(&galley, project_id, "final", tail, all).await?;
    let live = probe_project_live(detail_ids(&final_snapshot.sessions)).await;
    final_snapshot.follow_state = Some(project_follow_state(
        mode,
        &final_snapshot.sessions,
        live.as_ref(),
    ));
    emit_json(&final_snapshot)
}

async fn project_follow_until_idle(
    project_id: String,
    tail: usize,
    all: bool,
    final_show: bool,
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
                            emit_project_final_snapshot(&project_id, tail, all, "until_idle")
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
                // A live runner stays subscribed after its run ends, so a
                // quiet stream is not the end: Core's run state decides.
                if !project_has_active_sessions(&project_id, all).await? {
                    if final_show {
                        emit_project_final_snapshot(&project_id, tail, all, "until_idle").await?;
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

pub(crate) async fn project_follow(
    project_id: String,
    tail: usize,
    all: bool,
    until_idle: bool,
    final_show: bool,
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let mut initial = project_snapshot_payload(&galley, &project_id, "initial", tail, all).await?;
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
    let live = probe_project_live(detail_ids(&initial.sessions)).await;
    initial.follow_state = Some(project_follow_state(mode, &initial.sessions, live.as_ref()));
    emit_json(&initial)?;

    if watch_targets.is_empty() {
        if final_show {
            emit_project_final_snapshot(&project_id, tail, all, mode).await?;
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
        return project_follow_until_idle(project_id, tail, all, final_show, rx).await;
    }

    let mut saw_stream_item = false;
    while let Some(item) = rx.recv().await {
        saw_stream_item = true;
        emit_project_watch_item(item)?;
    }

    if !saw_stream_item {
        if final_show {
            emit_project_final_snapshot(&project_id, tail, all, mode).await?;
        }
        emit_json(&StreamEndPayload {
            schema_version: SCHEMA_VERSION,
            stream: "end",
            reason: "no_live_sessions",
        })?;
        return Ok(());
    }

    emit_project_final_snapshot(&project_id, tail, all, mode).await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn brief(id: &str, status: &str) -> SessionBrief {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "title": id,
            "status": status,
            "lastActivityAt": "2026-11-10T00:00:00Z",
            "createdAt": "2026-11-10T00:00:00Z",
            "updatedAt": "2026-11-10T00:00:00Z",
            "runtimeKind": "managed",
            "runtimeLabel": "Galley",
            "gaRuntimeKind": "managed",
        }))
        .expect("session brief")
    }

    fn detail(id: &str, status: &str) -> ProjectSessionDetail {
        ProjectSessionDetail {
            session: brief(id, status),
            messages: Vec::new(),
        }
    }

    fn live(open_run: bool, agent_running: bool) -> Value {
        serde_json::json!({
            "runnerAlive": true,
            "agentRunning": agent_running,
            "openRun": open_run,
            "queuedCount": 0,
            "busy": open_run || agent_running,
            "askPending": false,
            "lastExit": null,
        })
    }

    fn states() -> LiveStates {
        LiveStates::from([
            ("running".to_string(), live(true, false)),
            ("mid-step".to_string(), live(false, true)),
            ("ended".to_string(), live(false, false)),
        ])
    }

    #[test]
    fn live_state_decides_and_persisted_status_is_only_the_fallback() {
        let states = states();
        // Persisted `idle` (all Core ever writes) while Core says a run is
        // open or a step is in progress: active.
        assert!(session_active(&brief("running", "idle"), Some(&states)));
        assert!(session_active(&brief("mid-step", "idle"), Some(&states)));
        assert!(!session_active(&brief("ended", "idle"), Some(&states)));
        // A stale persisted `running` row Core reports as ended: not active.
        assert!(!session_active(&brief("ended", "running"), Some(&states)));
        // No entry from a reachable Core: no run.
        assert!(!session_active(&brief("unknown", "idle"), Some(&states)));
        // Core unreachable: the persisted status, as before.
        assert!(session_active(&brief("running", "running"), None));
        assert!(!session_active(&brief("running", "idle"), None));
    }

    #[test]
    fn follow_state_counts_come_from_live_state_when_core_answers() {
        let details = vec![
            detail("running", "idle"),
            detail("ended", "idle"),
            detail("old", "archived"),
        ];
        let states = states();
        let with_core = project_follow_state("until_idle", &details, Some(&states));
        assert_eq!(with_core.state, "active_status_sessions");
        assert_eq!(with_core.watched_sessions, 3);
        assert_eq!(with_core.active_status_sessions, 1);
        assert_eq!(with_core.idle_status_sessions, 1);

        let without_core = project_follow_state("until_idle", &details, None);
        assert_eq!(without_core.state, "checking_live_events");
        assert_eq!(without_core.active_status_sessions, 0);
        assert_eq!(without_core.idle_status_sessions, 2);
    }
}
