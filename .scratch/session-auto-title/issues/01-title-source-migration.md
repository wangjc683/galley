# 01: `title_source` migration 与写入语义

Status: ready-for-human（已实现，待 dogfood 验收）

## 范围

- 新增 migration `038_session_title_source.sql`：
  `ALTER TABLE sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'user'`
  + 存量回填：`title = '新对话'` → `'seed'`（保守：其余一律 user）。
- 值域：`seed`（默认占位）/ `derived`（GUI 首条消息截断）/ `auto`（LLM 生成）/
  `user`（人工或 supervisor 指定）。
- **种子态判定收在 core 插入时**（勘误 PRD 定案 3 的「GUI 创建时打标」）：
  `insert_session_row_inner` 里 `title == DEFAULT_NEW_SESSION_TITLE("新对话")`
  → seed，否则 user。理由：CLI `session new` 不传标题时也落同一常量
  （`session_new_cmds.rs`），两条创建路径一处覆盖，且 CreateSessionInput /
  Agent API 零改动。
- **勘误 PRD「背景」段**：GUI 已有 `maybeDeriveTitle`（首条用户消息截断，
  `lifecycle-slice.ts:741`），即 F3 已上线。它经 `rename_session` 落库，必须
  与用户改名区分：Tauri 命令 `rename_session` 增加可选 `titleSource` 参数
  （缺省 `user`；derive 调用传 `derived`）。`GalleyApi` trait 不动，socket /
  CLI rename 语义不变（恒 user）。
- 自动标题写入走新的内部方法 `try_apply_auto_title(id, title)`：条件 UPDATE
  `... SET title=?, title_source='auto' WHERE id=? AND title_source IN
  ('seed','derived')`——CAS 一步完成竞态复核，rows_affected=0 即放弃。

## 验收

- cargo test：insert 标记（seed vs user）、derive 标记、CAS 各态（user 不被覆盖）。
- 存量回填单测（in-memory 池跑 migration）。
