use super::*;
use async_trait::async_trait;

#[async_trait]
impl GalleyApi for SqliteGalley {
    async fn list_sessions(&self, filter: SessionFilter) -> Result<Vec<SessionBrief>> {
        self.list_sessions_db(filter).await
    }

    async fn session_brief(&self, id: SessionId) -> Result<SessionBrief> {
        self.session_brief_db(id).await
    }

    async fn session_messages(
        &self,
        id: SessionId,
        tail: Option<usize>,
    ) -> Result<Vec<MessageBrief>> {
        self.session_messages_db(id, tail).await
    }

    async fn search_messages(
        &self,
        query: String,
        scope: SearchScope,
        runtime_kind: Option<RuntimeKind>,
    ) -> Result<Vec<SearchHit>> {
        self.search_messages_db(query, scope, runtime_kind).await
    }

    async fn status(&self) -> Result<StatusSummary> {
        self.status_db().await
    }

    async fn health(&self) -> Result<HealthReport> {
        self.health_db().await
    }

    async fn send_message(
        &self,
        session_id: SessionId,
        content: String,
        origin: crate::api::Origin,
    ) -> Result<MessageBrief> {
        self.send_message_db(session_id, content, origin).await
    }

    async fn send_message_with_visibility(
        &self,
        session_id: SessionId,
        content: String,
        origin: crate::api::Origin,
        visibility: MessageVisibility,
    ) -> Result<MessageBrief> {
        self.send_message_with_visibility_db(session_id, content, origin, visibility)
            .await
    }

    async fn send_system_message(
        &self,
        session_id: SessionId,
        content: String,
        origin: crate::api::Origin,
    ) -> Result<MessageBrief> {
        self.send_system_message_db(session_id, content, origin)
            .await
    }

    async fn send_message_for_goal(
        &self,
        session_id: SessionId,
        content: String,
        origin: crate::api::Origin,
        goal_id: GoalId,
    ) -> Result<MessageBrief> {
        self.send_message_for_goal_db(session_id, content, origin, goal_id)
            .await
    }

    async fn send_system_message_for_goal(
        &self,
        session_id: SessionId,
        content: String,
        origin: crate::api::Origin,
        goal_id: GoalId,
    ) -> Result<MessageBrief> {
        self.send_system_message_for_goal_db(session_id, content, origin, goal_id)
            .await
    }

    async fn create_session(
        &self,
        input: CreateSessionInput,
        origin: Origin,
    ) -> Result<SessionBrief> {
        self.create_session_db(input, origin).await
    }

    async fn archive_session(&self, id: SessionId, _origin: Origin) -> Result<SessionBrief> {
        self.archive_session_db(id, _origin).await
    }

    async fn unarchive_session(&self, id: SessionId, _origin: Origin) -> Result<SessionBrief> {
        self.unarchive_session_db(id, _origin).await
    }

    async fn rename_session(
        &self,
        id: SessionId,
        title: String,
        _origin: Origin,
    ) -> Result<SessionBrief> {
        self.rename_session_db(id, title, _origin).await
    }

    async fn set_session_pinned(
        &self,
        id: SessionId,
        pinned: bool,
        _origin: Origin,
    ) -> Result<SessionBrief> {
        self.set_session_pinned_db(id, pinned, _origin).await
    }

    async fn set_session_approval_mode(
        &self,
        id: SessionId,
        mode: Option<String>,
        _origin: Origin,
    ) -> Result<SessionBrief> {
        self.set_session_approval_mode_db(id, mode, _origin).await
    }

    async fn delete_session(&self, id: SessionId, _origin: Origin) -> Result<()> {
        self.delete_session_db(id, _origin).await
    }

    async fn assign_session_to_project(
        &self,
        session_id: SessionId,
        project_id: Option<String>,
        _origin: Origin,
    ) -> Result<SessionBrief> {
        self.assign_session_to_project_db(session_id, project_id, _origin)
            .await
    }

    async fn set_session_llm(
        &self,
        id: SessionId,
        index: Option<u32>,
        key: Option<String>,
        display_name: Option<String>,
    ) -> Result<SessionBrief> {
        self.set_session_llm_db(id, index, key, display_name).await
    }

    async fn bump_session_after_turn(
        &self,
        id: SessionId,
        summary: Option<String>,
        step_number: Option<u32>,
        mark_unread: bool,
    ) -> Result<SessionBrief> {
        self.bump_session_after_turn_db(id, summary, step_number, mark_unread)
            .await
    }

    async fn clear_session_unread(&self, id: SessionId) -> Result<()> {
        self.clear_session_unread_db(id).await
    }

    async fn bulk_archive_sessions(&self, ids: Vec<SessionId>, _origin: Origin) -> Result<u32> {
        self.bulk_archive_sessions_db(ids, _origin).await
    }

    async fn bulk_unarchive_sessions(&self, ids: Vec<SessionId>, _origin: Origin) -> Result<u32> {
        self.bulk_unarchive_sessions_db(ids, _origin).await
    }

    async fn bulk_delete_sessions(&self, ids: Vec<SessionId>, _origin: Origin) -> Result<u32> {
        self.bulk_delete_sessions_db(ids, _origin).await
    }

    async fn list_projects(&self) -> Result<Vec<ProjectBrief>> {
        self.list_projects_db().await
    }

    async fn create_project(
        &self,
        input: CreateProjectInput,
        _origin: Origin,
    ) -> Result<ProjectBrief> {
        self.create_project_db(input, _origin).await
    }

    async fn update_project(
        &self,
        id: ProjectId,
        patch: ProjectPatch,
        _origin: Origin,
    ) -> Result<ProjectBrief> {
        self.update_project_db(id, patch, _origin).await
    }

    async fn delete_project(&self, id: ProjectId, _origin: Origin) -> Result<()> {
        self.delete_project_db(id, _origin).await
    }

    async fn create_goal_proposal(
        &self,
        input: CreateGoalProposalInput,
        _origin: Origin,
    ) -> Result<GoalProposalBrief> {
        self.create_goal_proposal_db(input, _origin).await
    }

    async fn start_goal_from_proposal(
        &self,
        proposal_id: GoalProposalId,
        internal_confirm_token: String,
        _origin: Origin,
    ) -> Result<GoalBrief> {
        self.start_goal_from_proposal_db(proposal_id, internal_confirm_token, _origin)
            .await
    }

    async fn goal_status(&self, id: GoalId) -> Result<GoalStatusSnapshot> {
        self.goal_status_db(id, Some(50)).await
    }

    async fn goal_status_full(&self, id: GoalId) -> Result<GoalStatusSnapshot> {
        self.goal_status_db(id, None).await
    }

    async fn set_goal_deliverable(
        &self,
        goal_id: GoalId,
        content: String,
        note: Option<String>,
        author_session_id: Option<SessionId>,
    ) -> Result<GoalDeliverable> {
        self.set_goal_deliverable_db(goal_id, content, note, author_session_id)
            .await
    }

    async fn latest_goal_deliverable(&self, goal_id: GoalId) -> Result<Option<GoalDeliverable>> {
        self.latest_goal_deliverable_db(goal_id).await
    }

    async fn list_active_goals(&self) -> Result<Vec<GoalBrief>> {
        self.list_active_goals_db().await
    }

    async fn list_visible_goals(&self) -> Result<Vec<GoalBrief>> {
        self.list_visible_goals_db().await
    }

    async fn list_goals_for_session(&self, master_session_id: SessionId) -> Result<Vec<GoalBrief>> {
        self.list_goals_for_session_db(master_session_id).await
    }

    async fn mark_goal_result_seen(&self, id: GoalId, _origin: Origin) -> Result<GoalBrief> {
        self.mark_goal_result_seen_db(id, _origin).await
    }

    async fn request_goal_stop(&self, id: GoalId, _origin: Origin) -> Result<GoalBrief> {
        self.request_goal_stop_db(id, _origin).await
    }

    async fn update_goal_state(
        &self,
        id: GoalId,
        status: GoalStatus,
        latest_summary: Option<String>,
    ) -> Result<GoalBrief> {
        self.update_goal_state_db(id, status, latest_summary).await
    }

    async fn create_goal_task(&self, input: CreateGoalTaskInput) -> Result<GoalTaskBrief> {
        self.create_goal_task_db(input).await
    }

    async fn claim_goal_task(&self, input: ClaimGoalTaskInput) -> Result<GoalTaskBrief> {
        self.claim_goal_task_db(input).await
    }

    async fn update_goal_task(&self, input: UpdateGoalTaskInput) -> Result<GoalTaskBrief> {
        self.update_goal_task_db(input).await
    }

    async fn create_goal_event(&self, input: CreateGoalEventInput) -> Result<GoalEventBrief> {
        self.create_goal_event_db(input).await
    }

    async fn create_session_in_tx<'c>(
        &self,
        tx: &mut Transaction<'c, Sqlite>,
        input: CreateSessionInput,
        origin: Origin,
    ) -> Result<SessionBrief> {
        self.create_session_in_tx_db(tx, input, origin).await
    }

    async fn send_message_in_tx<'c>(
        &self,
        tx: &mut Transaction<'c, Sqlite>,
        session_id: SessionId,
        content: String,
        origin: Origin,
    ) -> Result<MessageBrief> {
        self.send_message_in_tx_db(tx, session_id, content, origin)
            .await
    }

    async fn begin_tx(&self) -> Result<Transaction<'_, Sqlite>> {
        self.begin_tx_db().await
    }

    async fn get_pref_json(&self, key: &str) -> Result<Option<serde_json::Value>> {
        self.get_pref_json_db(key).await
    }
}
