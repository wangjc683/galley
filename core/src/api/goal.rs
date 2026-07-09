use serde::{Deserialize, Serialize};

use super::{ProjectBrief, ProjectId, RuntimeKind, SessionBrief, SessionId};

pub const DEFAULT_GOAL_BUDGET_SECONDS: u32 = 30 * 60;
pub const MIN_GOAL_WORKER_LIMIT: u32 = 1;
pub const DEFAULT_GOAL_WORKER_LIMIT: u32 = 3;
pub const MAX_GOAL_WORKER_LIMIT: u32 = 5;
pub const GOAL_CONFIRMATION_PHRASE: &str = "确认启动 Goal";

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GoalId(pub String);

impl GoalId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for GoalId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GoalProposalId(pub String);

impl GoalProposalId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for GoalProposalId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GoalTaskId(pub String);

impl GoalTaskId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for GoalTaskId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalProposalStatus {
    AwaitingConfirmation,
    Started,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Running,
    Wrapping,
    Completed,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalWriteMode {
    Autonomous,
    ReadOnly,
}

/// Which orchestration engine runs the Goal.
///
/// - `Hive`: master + parallel workers + task board (multi-angle,
///   independently cross-verified; slower/costlier). The historical default.
/// - `Solo`: a single agent runs the objective to budget exhaustion,
///   Core-owned, no worker coordination. The product default for a human
///   operator (the GUI sends `Solo`); the API/CLI keep `Hive` as the
///   backward-compatible default so existing supervisor callers are unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalMode {
    Hive,
    Solo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalTaskStatus {
    Open,
    Claimed,
    Running,
    Completed,
    Blocked,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalEventType {
    Plan,
    Claim,
    Progress,
    Result,
    Conflict,
    Synthesis,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalProposalBrief {
    pub id: GoalProposalId,
    pub objective: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<ProjectId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_session_id: Option<SessionId>,
    pub budget_seconds: u32,
    pub worker_limit: u32,
    pub runtime_kind: RuntimeKind,
    pub write_mode: GoalWriteMode,
    pub mode: GoalMode,
    pub status: GoalProposalStatus,
    /// Internal token for trusted local supervisors. Do not show it in
    /// user-facing confirmation copy.
    pub internal_confirm_token: String,
    pub confirmation_phrase: String,
    pub expires_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalBrief {
    pub id: GoalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_id: Option<GoalProposalId>,
    /// `None` for a solo Goal launched outside any project (it stays
    /// project-less, like a plain session). Hive goals always have one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<ProjectId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_session_id: Option<SessionId>,
    pub objective: String,
    pub status: GoalStatus,
    pub budget_seconds: u32,
    pub worker_limit: u32,
    pub runtime_kind: RuntimeKind,
    pub write_mode: GoalWriteMode,
    pub mode: GoalMode,
    pub started_at: String,
    pub deadline_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_seen_at: Option<String>,
    pub stop_requested: bool,
    /// Galley-owned scratch workspace for file/code deliverables (P3).
    /// Always set for goals created post-migration-019; the directory
    /// is created lazily by the agents on first write.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    /// Task-board counters and the deliverable anchor version, computed
    /// by the queries that feed live surfaces (visible list, status,
    /// per-session list). `None` on queries that don't compute them —
    /// additive within schemaVersion 1, so consumers must treat absent
    /// as "unknown", not zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_task_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deliverable_version: Option<u32>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalTaskBrief {
    pub id: GoalTaskId,
    pub goal_id: GoalId,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: GoalTaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_session_id: Option<SessionId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalEventBrief {
    pub id: i64,
    pub goal_id: GoalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<GoalTaskId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_session_id: Option<SessionId>,
    pub event_type: GoalEventType,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalDeliverable {
    pub id: String,
    pub goal_id: GoalId,
    pub version: u32,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_session_id: Option<SessionId>,
    pub created_at: String,
}

/// "Which Goal is this worker session part of, and what is it working
/// on" — resolved by reverse lookup through `goal_tasks.owner_session_id`
/// (worker sessions carry no schema marker of their own). `task` is the
/// most recently updated task the session owns; a worker that claimed
/// tasks across several waves reports its latest one.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalWorkerContext {
    pub goal: GoalBrief,
    pub task: GoalTaskBrief,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalStatusSnapshot {
    pub goal: GoalBrief,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<ProjectBrief>,
    pub tasks: Vec<GoalTaskBrief>,
    pub events: Vec<GoalEventBrief>,
    pub sessions: Vec<SessionBrief>,
    /// Current best deliverable anchor (highest version), if the master
    /// has produced one. None falls back to one-shot synthesis at wrap-up.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deliverable: Option<GoalDeliverable>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalProposalInput {
    pub objective: String,
    #[serde(default)]
    pub project_id: Option<ProjectId>,
    #[serde(default)]
    pub master_session_id: Option<SessionId>,
    #[serde(default)]
    pub budget_seconds: Option<u32>,
    #[serde(default)]
    pub worker_limit: Option<u32>,
    #[serde(default)]
    pub runtime_kind: Option<RuntimeKind>,
    #[serde(default)]
    pub write_mode: Option<GoalWriteMode>,
    #[serde(default)]
    pub mode: Option<GoalMode>,
    #[serde(default)]
    pub expires_in_seconds: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalTaskInput {
    pub goal_id: GoalId,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub owner_session_id: Option<SessionId>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGoalTaskInput {
    pub task_id: GoalTaskId,
    #[serde(default)]
    pub status: Option<GoalTaskStatus>,
    #[serde(default)]
    pub owner_session_id: Option<Option<SessionId>>,
    #[serde(default)]
    pub scope: Option<Option<String>>,
    #[serde(default)]
    pub result_summary: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimGoalTaskInput {
    pub task_id: GoalTaskId,
    pub owner_session_id: SessionId,
    #[serde(default)]
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalEventInput {
    pub goal_id: GoalId,
    #[serde(default)]
    pub task_id: Option<GoalTaskId>,
    #[serde(default)]
    pub author_session_id: Option<SessionId>,
    pub event_type: GoalEventType,
    pub body: String,
}

/// Resolved UI locale for the Goal *system narration* that Rust persists
/// into the master session — the Core launch acknowledgement and the CLI
/// controller's lifecycle checkpoints.
///
/// These rows are written by Rust (Core + the detached CLI controller),
/// which cannot reach the GUI's i18n. Following the same precedent as the
/// background close-hint copy, the operator's *resolved* locale is handed
/// down at launch (`start_desktop_goal` input → `--locale` on the spawned
/// controller) and the narration text is selected from this table.
///
/// Defaults to `ZhCn` so a caller that omits the locale keeps the
/// pre-localization behavior (the surface shipped Chinese-only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalLocale {
    ZhCn,
    EnUs,
}

impl GoalLocale {
    /// Parse a GUI locale tag (`zh-CN` / `en-US`, case-insensitive). Any
    /// `en*` tag resolves to English; everything else (including `None`)
    /// falls back to Chinese to preserve the original behavior.
    pub fn parse(tag: Option<&str>) -> Self {
        match tag {
            Some(t) if t.trim().to_ascii_lowercase().starts_with("en") => GoalLocale::EnUs,
            _ => GoalLocale::ZhCn,
        }
    }

    /// Canonical tag, e.g. for forwarding to the controller via `--locale`.
    pub fn as_tag(self) -> &'static str {
        match self {
            GoalLocale::ZhCn => "zh-CN",
            GoalLocale::EnUs => "en-US",
        }
    }
}

/// Master-session launch acknowledgement (Core `start_desktop_goal`). Solo
/// works right here in the thread, so it promises live progress; hive works
/// in worker sessions and only the summarized result returns.
pub fn goal_launch_ack(locale: GoalLocale, mode: GoalMode) -> &'static str {
    match (locale, mode) {
        (GoalLocale::ZhCn, GoalMode::Solo) => "Goal 已启动 · 运行过程和结果都会显示在这个对话",
        (GoalLocale::ZhCn, GoalMode::Hive) => "Goal 已启动 · 完成后会在这个对话汇总结果",
        (GoalLocale::EnUs, GoalMode::Solo) => {
            "Goal started · progress and the result will show in this conversation"
        }
        (GoalLocale::EnUs, GoalMode::Hive) => {
            "Goal started · the result will be summarized in this conversation when it's done"
        }
    }
}

/// Controller checkpoint: master has started planning / splitting work.
pub fn goal_checkpoint_planning_started(locale: GoalLocale) -> &'static str {
    match locale {
        GoalLocale::ZhCn => "Galley 正在拆分任务。",
        GoalLocale::EnUs => "Galley is breaking the work into tasks.",
    }
}

/// Controller checkpoint: `count` worker agents have started.
pub fn goal_checkpoint_workers_started(locale: GoalLocale, count: usize) -> String {
    match locale {
        GoalLocale::ZhCn => format!("已启动 {count} 个 Agent，正在执行已分配任务。"),
        GoalLocale::EnUs => {
            let noun = if count == 1 { "agent" } else { "agents" };
            format!("Started {count} {noun}; they're working on the assigned tasks.")
        }
    }
}

/// Controller checkpoint: first worker material has appeared.
pub fn goal_checkpoint_first_material(locale: GoalLocale) -> &'static str {
    match locale {
        GoalLocale::ZhCn => "已有初步进展，正在继续核对和整理。",
        GoalLocale::EnUs => "Early progress is in; Galley is checking and organizing it.",
    }
}

/// Controller checkpoint: run time reached; draining current work.
pub fn goal_checkpoint_deadline_reached(locale: GoalLocale) -> &'static str {
    match locale {
        GoalLocale::ZhCn => "运行时间已到，正在等待当前任务收尾并整理结果。",
        GoalLocale::EnUs => {
            "Run time is up; Galley is letting current work finish and preparing the result."
        }
    }
}

/// Master-session visible note dispatched alongside final synthesis.
pub fn goal_synthesizing(locale: GoalLocale) -> &'static str {
    match locale {
        GoalLocale::ZhCn => "正在生成最终汇总。",
        GoalLocale::EnUs => "Generating the final summary.",
    }
}

#[cfg(test)]
mod goal_locale_tests {
    use super::*;

    #[test]
    fn parse_resolves_english_tags_and_defaults_to_chinese() {
        assert_eq!(GoalLocale::parse(Some("en-US")), GoalLocale::EnUs);
        assert_eq!(GoalLocale::parse(Some("EN")), GoalLocale::EnUs);
        assert_eq!(GoalLocale::parse(Some("zh-CN")), GoalLocale::ZhCn);
        assert_eq!(GoalLocale::parse(Some("")), GoalLocale::ZhCn);
        assert_eq!(GoalLocale::parse(None), GoalLocale::ZhCn);
    }

    #[test]
    fn workers_started_pluralizes_english() {
        assert_eq!(
            goal_checkpoint_workers_started(GoalLocale::EnUs, 1),
            "Started 1 agent; they're working on the assigned tasks."
        );
        assert!(goal_checkpoint_workers_started(GoalLocale::EnUs, 3).contains("3 agents"));
        assert!(goal_checkpoint_workers_started(GoalLocale::ZhCn, 3).contains("3 个 Agent"));
    }
}
