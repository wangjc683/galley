use super::*;

impl SqliteGalley {
    pub async fn delete_empty_new_sessions(&self) -> Result<u32> {
        let res = sqlx::query(
            "DELETE FROM sessions \
             WHERE title = ? \
               AND turn_count = 0 \
               AND status != 'archived'",
        )
        .bind(DEFAULT_NEW_SESSION_TITLE)
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(res.rows_affected() as u32)
    }

    pub async fn delete_demo_sessions(&self) -> Result<u32> {
        let res = sqlx::query(
            "DELETE FROM sessions \
             WHERE id IN ('s-today-1','s-today-2','s-today-3', \
                          's-week-1','s-week-2','s-earlier-1')",
        )
        .execute(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        Ok(res.rows_affected() as u32)
    }

    pub async fn backfill_fts_if_empty(&self) -> Result<u32> {
        let msg_cnt: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM messages \
             WHERE role IN ('user','assistant') \
               AND visibility = 'visible' \
               AND COALESCE(NULLIF(TRIM(CASE \
                 WHEN role = 'user' THEN content \
                 WHEN role = 'assistant' THEN COALESCE(final_answer, content) \
               END), ''), '') != ''",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(map_sqlx_err)?;
        let fts_cnt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages_fts")
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        if fts_cnt >= msg_cnt {
            return Ok(0);
        }

        let mut tx = self.pool.begin().await.map_err(map_sqlx_err)?;
        sqlx::query("DELETE FROM messages_fts")
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
        let res = sqlx::query(
            "INSERT INTO messages_fts (message_id, session_id, role, turn_index, body) \
             SELECT \
               id, \
               session_id, \
               role, \
               turn_index, \
               CASE \
                 WHEN role = 'user' THEN content \
                 WHEN role = 'assistant' THEN COALESCE(final_answer, content) \
               END AS body \
             FROM messages \
             WHERE role IN ('user','assistant') \
               AND visibility = 'visible' \
               AND COALESCE(NULLIF(TRIM(CASE \
                 WHEN role = 'user' THEN content \
                 WHEN role = 'assistant' THEN COALESCE(final_answer, content) \
               END), ''), '') != ''",
        )
        .execute(&mut *tx)
        .await
        .map_err(map_sqlx_err)?;
        tx.commit().await.map_err(map_sqlx_err)?;
        Ok(res.rows_affected() as u32)
    }

    pub async fn search_message_hits(
        &self,
        query: String,
        limit: u32,
        runtime_kind: Option<RuntimeKind>,
    ) -> Result<Vec<MessageSearchHit>> {
        if let Some(kind) = runtime_kind {
            crate::runtime::ensure_runtime_filter_available(kind)?;
        }
        let q = query.trim();
        if q.chars().count() < 2 {
            return Ok(vec![]);
        }
        let limit = i64::from(limit);
        let runtime_clause = if runtime_kind.is_some() {
            " AND s.ga_runtime_kind = ?"
        } else {
            ""
        };

        if q.chars().count() >= 3 {
            let phrase = format!("\"{}\"", q.replace('"', "\"\""));
            let sql = format!(
                "SELECT \
                   fts.message_id AS message_id, \
                   fts.session_id AS session_id, \
                   fts.role AS role, \
                   fts.turn_index AS turn_index, \
                   snippet(messages_fts, 4, '«', '»', '…', 16) AS snippet, \
                   s.title AS session_title, \
                   s.last_activity_at AS session_activity_at \
                 FROM messages_fts fts \
                 JOIN messages m ON m.id = fts.message_id \
                 JOIN sessions s ON s.id = fts.session_id \
                 WHERE messages_fts MATCH ? \
                   AND m.visibility = 'visible' \
                   AND s.status != 'archived'{runtime_clause} \
                 ORDER BY s.last_activity_at DESC \
                 LIMIT ?"
            );
            let mut query = sqlx::query_as::<_, MessageSearchHit>(&sql).bind(&phrase);
            if let Some(kind) = runtime_kind {
                query = query.bind(runtime_kind_sql(kind));
            }
            let res = query.bind(limit).fetch_all(&self.pool).await;
            match res {
                Ok(rows) => return Ok(rows),
                Err(e) => {
                    eprintln!("[galley-core] GUI FTS5 search failed, falling back: {e}");
                }
            }
        }

        let like = format!("%{}%", escape_like(q));
        let sql = format!(
            "SELECT \
               m.id AS message_id, \
               m.session_id AS session_id, \
               m.role AS role, \
               m.turn_index AS turn_index, \
               substr(CASE \
                 WHEN m.role = 'user' THEN m.content \
                 WHEN m.role = 'assistant' THEN COALESCE(m.final_answer, m.content) \
               END, 1, 200) AS snippet, \
               s.title AS session_title, \
               s.last_activity_at AS session_activity_at \
             FROM messages m \
             JOIN sessions s ON s.id = m.session_id \
             WHERE m.role IN ('user','assistant') \
               AND m.visibility = 'visible' \
               AND s.status != 'archived' \
               AND ( \
                 m.content LIKE ? ESCAPE '\\' \
                 OR m.final_answer LIKE ? ESCAPE '\\' \
               ){runtime_clause} \
             ORDER BY s.last_activity_at DESC \
             LIMIT ?"
        );
        let mut query = sqlx::query_as::<_, MessageSearchHit>(&sql)
            .bind(&like)
            .bind(&like);
        if let Some(kind) = runtime_kind {
            query = query.bind(runtime_kind_sql(kind));
        }
        let rows = query
            .bind(limit)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        Ok(rows
            .into_iter()
            .map(|mut row| {
                row.snippet = highlight_like(&row.snippet, q);
                row
            })
            .collect())
    }

    pub(super) async fn index_message_fts(
        &self,
        message_id: &str,
        session_id: &str,
        role: &str,
        turn_index: u32,
        body: &str,
    ) {
        let res = async {
            sqlx::query("DELETE FROM messages_fts WHERE message_id = ?")
                .bind(message_id)
                .execute(&self.pool)
                .await?;
            sqlx::query(
                "INSERT INTO messages_fts (message_id, session_id, role, turn_index, body)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(message_id)
            .bind(session_id)
            .bind(role)
            .bind(i64::from(turn_index))
            .bind(body)
            .execute(&self.pool)
            .await?;
            std::result::Result::<(), sqlx::Error>::Ok(())
        }
        .await;
        if let Err(e) = res {
            eprintln!("[galley-core] index_message_fts failed: {e}");
        }
    }
}

impl SqliteGalley {
    pub(super) async fn search_messages_db(
        &self,
        query: String,
        scope: SearchScope,
        runtime_kind: Option<RuntimeKind>,
    ) -> Result<Vec<SearchHit>> {
        if let Some(kind) = runtime_kind {
            crate::runtime::ensure_runtime_filter_available(kind)?;
        }
        let q = query.trim();
        if q.len() < 2 {
            return Ok(vec![]);
        }
        const LIMIT: i64 = 20;

        // FTS5 trigram path (>= 3 chars). Wraps as a phrase so SQLite
        // treats the whole thing as a literal — matches the GUI's
        // searchMessages() behaviour exactly.
        if q.chars().count() >= 3 {
            let phrase = format!("\"{}\"", q.replace('"', "\"\""));
            let scope_clause = match scope {
                SearchScope::All => "",
                SearchScope::Active => " AND s.status != 'archived'",
            };
            let runtime_clause = if runtime_kind.is_some() {
                " AND s.ga_runtime_kind = ?"
            } else {
                ""
            };
            let sql = format!(
                "SELECT fts.message_id AS message_id, \
                        fts.session_id AS session_id, \
                        snippet(messages_fts, 4, '<mark>', '</mark>', '…', 16) AS snippet, \
                        bm25(messages_fts) AS rank \
                 FROM messages_fts fts \
                 JOIN messages m ON m.id = fts.message_id \
                 JOIN sessions s ON s.id = fts.session_id \
                 WHERE messages_fts MATCH ? \
                   AND m.visibility = 'visible'{scope_clause}{runtime_clause} \
                 ORDER BY rank ASC \
                 LIMIT ?"
            );
            let mut query = sqlx::query_as::<_, SearchHitRow>(&sql).bind(&phrase);
            if let Some(kind) = runtime_kind {
                query = query.bind(runtime_kind_sql(kind));
            }
            let res = query.bind(LIMIT).fetch_all(&self.pool).await;
            match res {
                Ok(rows) => return Ok(rows.into_iter().map(into_search_hit).collect()),
                Err(e) => {
                    // FTS5 MATCH can fail on weird inputs (rare with
                    // phrase wrapping but possible). Fall through to
                    // LIKE so the search still returns something.
                    eprintln!("[galley-core] FTS5 search failed, falling back: {e}");
                }
            }
        }

        // 2-char fallback (and FTS error recovery). LIKE substring,
        // no highlight wrapping — GUI handles highlighting client-side.
        let like = format!("%{}%", escape_like(q));
        let scope_clause = match scope {
            SearchScope::All => "",
            SearchScope::Active => " AND s.status != 'archived'",
        };
        let runtime_clause = if runtime_kind.is_some() {
            " AND s.ga_runtime_kind = ?"
        } else {
            ""
        };
        let sql = format!(
            "SELECT m.id AS message_id, \
                    m.session_id AS session_id, \
                    substr(m.content, 1, 200) AS snippet \
             FROM messages m \
             JOIN sessions s ON s.id = m.session_id \
             WHERE m.role IN ('user','assistant') \
               AND m.visibility = 'visible' \
               AND m.content LIKE ? ESCAPE '\\'{scope_clause}{runtime_clause} \
             ORDER BY s.last_activity_at DESC \
             LIMIT ?"
        );
        let mut query = sqlx::query_as::<_, SearchHitRow>(&sql).bind(&like);
        if let Some(kind) = runtime_kind {
            query = query.bind(runtime_kind_sql(kind));
        }
        let rows = query
            .bind(LIMIT)
            .fetch_all(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
        Ok(rows.into_iter().map(into_search_hit).collect())
    }
}
