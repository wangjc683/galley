-- 043_message_session_client.sql · which app a human used (iOS PRD ruling 9)
--
-- `created_via` keeps saying who acted (`gui` = a human); `client` says
-- through which app: `desktop` (the Galley window) or `ios` (the phone,
-- written by the remote module). NULL for everything else — CLI, IM,
-- agents, schedules, Goal continuations — and for every row written before
-- this migration. No CHECK on purpose: a new client must not need a table
-- rebuild. Core's `Origin.client` writes it; it is not part of the Agent
-- API (the CLI's JSON never carries it).
--
-- Numbered 043, not 041: released databases are already at 042, and the
-- pre-migration backup compares MAX(version) — a 041 landing below it
-- would run without a backup.
ALTER TABLE messages ADD COLUMN client TEXT;
ALTER TABLE sessions ADD COLUMN client TEXT;
