# 02 外置会话 `llm set` / `session new --llm` 必然失败：`llm_list` 缓存解析撞 serde 别名重复字段

Status: needs-triage
Date: 2026-09-30
来源：01 实施时子代理发现，主会话用本机真实缓存形状复现确认（与 01 无关，是既有缺陷）

## 现象

外置 GA 会话执行 `galley llm set <id> <name>` 或 `galley session new --runtime=external --llm=<name>`，
exit 2，报 `llm_list pref shape mismatch: duplicate field \`name\``。

## 根因

`core/src/socket_listener/llm_cmds.rs` 的 `LlmListEntry` 把 `name` 声明为 `#[serde(alias = "displayName")]`。
GUI 写入的 `llm_list` 缓存每条**同时**带 `name` 和 `displayName`（本机实测：
`{"displayName":"NativeOAI/gpt-6-astra","index":0,"isCurrent":false,"key":"…","name":"NativeOAI/gpt-6-astra"}`），
serde derive 把别名视为同一字段，两个键都出现即报 duplicate field。scratch 里用 core 锁定的 serde 1.0.228 /
serde_json 1.0.149 复现：`Err(Error("duplicate field \`name\`", line: 1, column: 103))`。

现有单测 `llm_list_entry_accepts_gui_display_name_cache`（`core/src/socket_listener/mod.rs`）只喂了单个 `displayName`，
没覆盖真实形状。

## 修法（草案）

去掉 alias，`name: Option<String>` + `display_name: Option<String>`（`#[serde(rename = "displayName")]`）分开收，
取 `name` 优先、`displayName` 回退（兼容只有 `displayName` 的老缓存）；两者都缺算形状错误。补一条用真实形状的单测，
外加一条外置 `llm set` 端到端测试。影响面只在外置运行时；内置零变化。
