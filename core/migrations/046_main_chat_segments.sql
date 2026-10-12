-- 046_main_chat_segments.sql · where the main chat's context segments start
-- (.scratch/main-chat/issues/03-segments-and-injection.md, 03a)
--
-- The user sees the main chat as one thread; the model sees it in
-- segments. After the main chat has been idle for more than N hours
-- (Core prefs `main_chat_segment_idle_hours`, default 4), the next
-- message starts a new segment: its runner starts on a fresh context,
-- and a cold runner is given back only the current segment's history.
--
-- One row per boundary. A segment holds every message whose turn_index
-- is at or after its row's `start_turn_index` (up to the next row's);
-- the turns before the first row are the first segment. Core records a
-- boundary once, at the moment it decides, and never re-derives it from
-- message times: tuning N later must not move past boundaries, and a
-- runner restored after a Core restart must get exactly the segment the
-- live runner had. The messages themselves are untouched; the desktop
-- shows the whole thread.
CREATE TABLE main_chat_segments (
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  start_turn_index  INTEGER NOT NULL,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (session_id, start_turn_index)
);
