# managed state root 的 GA 对话日志无保留策略，无限增长且明文堆积

Status: needs-triage
日期：2026-08-13
来源：Discord 方案外审票 4 的拆分项（Rule 4 解释已入宪：引擎日志属
引擎状态、不违宪——但「合宪」不等于「卫生」）。与 Discord 决策解耦，
影响现有 managed 渠道与 managed runtime 本体。

## 现象

GA 引擎把完整 prompt/response 写入
`<managed state root>/temp/model_responses/model_responses_*.txt`
（`managed-ga/code/llmcore.py` 的 `_write_llm_log`），服务 `/restore`
与排障。managed 模式下这些文件：

- 明文包含 supervisor ↔ 用户的完整对话（含 IM 渠道进来的内容）；
- 没有任何轮转、上限或清理机制，随使用无限增长；
- 位于 Galley 托管的 state root，用户不知道它存在，也没有 UI 入口
  查看或清理。

## 待议方向（未裁决）

- 轮转/上限：按数量或总大小保留最近 N 份；
- 或挂进 Galley 的某个既有清理面（如果有）；
- 是否在 Settings→Agent 或文档里向用户披露该目录的存在与用途。

注意边界：这是 managed runtime 自己的状态治理，动它属于 managed
patch 范畴（Rule 1 允许）；attach 模式的外部 GA 一概不碰。
