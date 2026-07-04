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
        // Rows per rebuild batch. Small enough that each batch's write
        // transaction commits in milliseconds, so concurrent writers
        // (IM supervisor autostart, socket sessions at GUI-hydrate
        // time) never sit on the write lock long enough to trip the
        // 5s busy_timeout (CONC-4).
        const BATCH_SIZE: i64 = 500;
        // Which message rows get indexed, and what `body` is. Shared
        // by the count probe and the batched rebuild; must stay in
        // sync with `index_message_fts` callers.
        const FTS_SOURCE_FILTER: &str = "role IN ('user','assistant') \
               AND visibility = 'visible' \
               AND COALESCE(NULLIF(TRIM(CASE \
                 WHEN role = 'user' THEN content \
                 WHEN role = 'assistant' THEN COALESCE(final_answer, content) \
               END), ''), '') != ''";

        let msg_cnt: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM messages WHERE {FTS_SOURCE_FILTER}"
        ))
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

        // Rebuild in small keyset-paginated batches, each its own
        // short transaction, yielding the write lock between batches.
        // The previous implementation did DELETE + INSERT..SELECT of
        // the entire visible history in ONE transaction, holding the
        // write lock for seconds to tens of seconds on 100k-message
        // histories.
        //
        // Step 1: clear the whole index in its own short statement.
        // A full DELETE is fast (no per-row body work to redo) and is
        // the simplest way to guarantee exact reconstruction — no
        // stale rows for deleted or now-hidden messages can survive.
        // Crash safety: a crash after this point leaves
        // fts_cnt < msg_cnt, so the next call re-triggers the rebuild
        // and converges.
        sqlx::query("DELETE FROM messages_fts")
            .execute(&self.pool)
            .await
            .map_err(map_sqlx_err)?;

        // Step 2: re-insert batch by batch, walking messages.id (TEXT
        // primary key) with keyset pagination.
        let mut last_id = String::new();
        let mut total: u32 = 0;
        loop {
            // Upper bound of the next batch, computed from the
            // messages PK index outside the write transaction.
            let batch_max: Option<String> = sqlx::query_scalar(&format!(
                "SELECT MAX(id) FROM ( \
                   SELECT id FROM messages \
                   WHERE {FTS_SOURCE_FILTER} \
                     AND id > ? \
                   ORDER BY id \
                   LIMIT ?)"
            ))
            .bind(&last_id)
            .bind(BATCH_SIZE)
            .fetch_one(&self.pool)
            .await
            .map_err(map_sqlx_err)?;
            let Some(batch_max) = batch_max else { break };

            let mut tx = self
                .pool
                .begin_with("BEGIN IMMEDIATE")
                .await
                .map_err(map_sqlx_err)?;
            // Delete-then-insert keyed by the id range (instead of a
            // bare INSERT) makes each batch idempotent and closes the
            // race with concurrent `index_message_fts`: a message
            // written — and live-indexed — after the full DELETE above
            // but before its batch runs would otherwise be inserted
            // twice. (INSERT OR REPLACE can't express this: FTS5 has
            // no UNIQUE constraint on message_id, so OR REPLACE would
            // degrade to a plain INSERT.)
            sqlx::query("DELETE FROM messages_fts WHERE message_id > ? AND message_id <= ?")
                .bind(&last_id)
                .bind(&batch_max)
                .execute(&mut *tx)
                .await
                .map_err(map_sqlx_err)?;
            let res = sqlx::query(&format!(
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
                 WHERE {FTS_SOURCE_FILTER} \
                   AND id > ? AND id <= ?"
            ))
            .bind(&last_id)
            .bind(&batch_max)
            .execute(&mut *tx)
            .await
            .map_err(map_sqlx_err)?;
            tx.commit().await.map_err(map_sqlx_err)?;

            total += res.rows_affected() as u32;
            last_id = batch_max;
        }
        Ok(total)
    }

    pub async fn search_message_hits(
        &self,
        query: String,
        limit: u32,
        runtime_kind: Option<RuntimeKind>,
    ) -> Result<Vec<MessageSearchHit>> {
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
