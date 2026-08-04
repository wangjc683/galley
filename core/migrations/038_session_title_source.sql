-- 038_session_title_source.sql
--
-- Auto-title eligibility marker (.scratch/session-auto-title):
--
--   seed    — still wearing the creation default ("新对话")
--   derived — GUI truncation of the first user message (maybeDeriveTitle)
--   auto    — LLM-generated session title
--   user    — a human or supervisor chose it; never overwritten
--
-- Auto-title may replace 'seed' and 'derived' rows only. The backfill is
-- conservative on purpose: old derived truncations are indistinguishable
-- from deliberate renames, so only rows still wearing the exact seed
-- default become 'seed' and everything else stays 'user'.
ALTER TABLE sessions
  ADD COLUMN title_source TEXT NOT NULL DEFAULT 'user'
  CHECK (title_source IN ('seed', 'derived', 'auto', 'user'));

UPDATE sessions SET title_source = 'seed' WHERE title = '新对话';
