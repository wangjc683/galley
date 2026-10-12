-- 044_session_main_chat.sql · the main chat (主聊天, .scratch/main-chat ticket 02)
--
-- The main chat is one permanent conversation the desktop opens on;
-- every other session is a side chat (旁聊). It exists only on the
-- managed runtime (PRD ruling 3), so `main_chat = 1` is allowed only on a
-- managed row, and the partial unique index lets at most one row carry
-- it — the same constant-key trick as `goals_single_active` (030): every
-- flagged row maps to the key (1). Core creates it on first ask
-- (`get_or_create_main_chat`); a concurrent second ask loses on this
-- index and reads the winner's row back.
--
-- The flag is set once, at creation, and never cleared: a side chat
-- cannot become the main chat, nor the main chat a side chat.
ALTER TABLE sessions
  ADD COLUMN main_chat INTEGER NOT NULL DEFAULT 0
  CHECK (main_chat IN (0, 1) AND (main_chat = 0 OR ga_runtime_kind = 'managed'));

CREATE UNIQUE INDEX IF NOT EXISTS sessions_single_main_chat
  ON sessions((1))
  WHERE main_chat = 1;
