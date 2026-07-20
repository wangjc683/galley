-- Per-session approval mode override. NULL = follow the global default
-- (the `yolo_mode` pref); 'auto' = run tools without step approval;
-- 'approval' = gate high-risk tools behind step approval. Written only
-- when the user explicitly picks a mode for the session in the composer
-- pill; cleared back to NULL by "恢复跟随默认".
ALTER TABLE sessions ADD COLUMN approval_mode TEXT;
