use super::*;

impl SqliteGalley {
    /// One project, `not_found` when there is none. Used by
    /// `create_project` / `update_project` to re-read the row after a
    /// write (NotFound there means an external concurrent DELETE won the
    /// race), and by `Writes::archive_project_sessions` as its existence
    /// check.
    pub async fn fetch_project(&self, id: &str) -> Result<ProjectBrief> {
        let row = sqlx::query_as::<_, ProjectRow>(
            "SELECT p.id, p.name, p.root_path, p.workspace_enabled, \
                p.icon, p.color, p.pinned, \
                CASE \
                    WHEN MAX(s.last_activity_at) IS NOT NULL \
                         AND MAX(s.last_activity_at) > p.created_at \
                    THEN MAX(s.last_activity_at) \
                    ELSE p.created_at \
                END AS last_activity_at, \
                p.created_at, p.updated_at \
             FROM projects p \
             LEFT JOIN sessions s \
                ON s.project_id = p.id AND s.status != 'archived' \
             WHERE p.id = ? \
             GROUP BY p.id, p.name, p.root_path, p.workspace_enabled, \
                p.icon, p.color, p.pinned, p.created_at, p.updated_at",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_sqlx_err)?
        .ok_or_else(|| GalleyError::NotFound {
            message: format!("project {id} not found"),
        })?;
        Ok(row.into_brief())
    }
}

impl SqliteGalley {
    pub(super) async fn list_projects_db(&self) -> Result<Vec<ProjectBrief>> {
        let rows = sqlx::query_as::<_, ProjectRow>(
            "SELECT p.id, p.name, p.root_path, p.workspace_enabled, \
                p.icon, p.color, p.pinned, \
                CASE \
                    WHEN MAX(s.last_activity_at) IS NOT NULL \
                         AND MAX(s.last_activity_at) > p.created_at \
                    THEN MAX(s.last_activity_at) \
                    ELSE p.created_at \
                END AS last_activity_at, \
                p.created_at, p.updated_at \
             FROM projects p \
             LEFT JOIN sessions s \
                ON s.project_id = p.id AND s.status != 'archived' \
             GROUP BY p.id, p.name, p.root_path, p.workspace_enabled, \
                p.icon, p.color, p.pinned, p.created_at, p.updated_at \
             ORDER BY p.pinned DESC, last_activity_at DESC, \
                p.name COLLATE NOCASE ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(rows.into_iter().map(ProjectRow::into_brief).collect())
    }

    pub(super) async fn create_project_db(
        &self,
        input: CreateProjectInput,
        _origin: Origin,
    ) -> Result<ProjectBrief> {
        let id = input.id.trim();
        if id.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "create_project: id must not be empty".into(),
            });
        }
        let name = input.name.trim();
        if name.is_empty() {
            return Err(GalleyError::InvalidArgs {
                message: "create_project: name must not be empty".into(),
            });
        }
        let root_path = input
            .root_path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let now = chrono_now_iso();
        sqlx::query(
            "INSERT INTO projects (id, name, root_path, workspace_enabled, \
                icon, color, pinned, \
                last_activity_at, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
        )
        .bind(id)
        .bind(name)
        .bind(&root_path)
        .bind(if input.workspace_enabled {
            1_i64
        } else {
            0_i64
        })
        .bind(&input.icon)
        .bind(&input.color)
        .bind(&now)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| map_constraint_err("create_project", e))?;
        self.fetch_project(id).await
    }

    pub(super) async fn update_project_db(
        &self,
        id: ProjectId,
        patch: ProjectPatch,
        _origin: Origin,
    ) -> Result<ProjectBrief> {
        // Existence check up-front gives a clean NotFound vs silently
        // 0-row UPDATE when every patch field is None.
        let exists: Option<String> = sqlx::query_scalar("SELECT id FROM projects WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        if exists.is_none() {
            return Err(GalleyError::NotFound {
                message: format!("project {id} not found"),
            });
        }
        // Build SET clause incrementally so omitted patch fields stay
        // at their current SQL value.
        let mut sets: Vec<&str> = Vec::with_capacity(6);
        let now = chrono_now_iso();
        let mut name_val: Option<String> = None;
        if let Some(raw) = patch.name.as_ref() {
            let t = raw.trim();
            if t.is_empty() {
                return Err(GalleyError::InvalidArgs {
                    message: "update_project: name must not be empty".into(),
                });
            }
            name_val = Some(t.to_string());
            sets.push("name = ?");
        }
        let (write_root, root_val) = project_nullable_patch(&patch.root_path);
        if write_root {
            sets.push("root_path = ?");
        }
        if patch.workspace_enabled.is_some() {
            sets.push("workspace_enabled = ?");
        }
        let (write_icon, icon_val) = project_nullable_patch(&patch.icon);
        if write_icon {
            sets.push("icon = ?");
        }
        let (write_color, color_val) = project_nullable_patch(&patch.color);
        if write_color {
            sets.push("color = ?");
        }
        if patch.pinned.is_some() {
            sets.push("pinned = ?");
        }
        sets.push("updated_at = ?");

        let sql = format!("UPDATE projects SET {} WHERE id = ?", sets.join(", "));
        let mut q = sqlx::query(&sql);
        if let Some(v) = name_val.as_ref() {
            q = q.bind(v);
        }
        if write_root {
            q = q.bind(&root_val);
        }
        if let Some(enabled) = patch.workspace_enabled {
            q = q.bind(if enabled { 1_i64 } else { 0_i64 });
        }
        if write_icon {
            q = q.bind(&icon_val);
        }
        if write_color {
            q = q.bind(&color_val);
        }
        if let Some(p) = patch.pinned {
            q = q.bind(if p { 1_i64 } else { 0_i64 });
        }
        q = q.bind(&now).bind(id.as_str());
        q.execute(&self.pool).await.map_err(map_sqlx_err)?;
        self.fetch_project(id.as_str()).await
    }

    pub(super) async fn delete_project_db(&self, id: ProjectId, _origin: Origin) -> Result<()> {
        let res = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id.as_str())
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        if res.rows_affected() == 0 {
            return Err(GalleyError::NotFound {
                message: format!("project {id} not found"),
            });
        }
        Ok(())
    }
}
