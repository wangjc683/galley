# PRD：README 截图第三版（重拍）

Status: 暂缓（2026-10-07 JC 裁决：截图先不动，不重拍）
Date: 2026-10-07
来源：README 全面排查（2026-10-07），文字已按审计结论改完，截图与图注原样保留
关联：[deferred「README 截图第三版」](../../docs/devlog/deferred.md) ·
[README 刷新 devlog](../../docs/devlog/2026-10-07-readme-refresh.md) ·
[截图 playbook](../../docs/screenshot-playbook.md) ·
[v2 拍摄计划 devlog](../../docs/devlog/2026-09-09-screenshot-set-v2-plan.md)

## 问题

`docs/screenshots/{en,zh}/` 的 18 张图全部来自 `bb92398a`（2026-09-09），之后
`gui/src` 有 76 个提交。每张都过时的外壳：侧栏 masthead 与通栏新对话行（v0.6.0）、
SOP 入口挪到顶栏、「已完成 · 」前缀改对勾圈、顶栏「显示」弹层与浏览器控制 /
聊天软件指示灯、输入框 ＋ 菜单与推理强度。

逐张（按重拍优先级）：

1. `goal.png`：语义最过时。画面是 v1 的「3 个 Agent · 预算 30 分钟」与三条并行
   线；v2 是单会话、委托装扮、时间上限。README 图注「章节标记 / chapter markers」
   也已失效，本轮按 JC 裁决原样保留。
2. `hero.png` / `hero-dark.png`：差异最大。两行实时窗口、步骤序号栏、思考预览、
   杏色气泡（暗色另调）、发送时间、浏览器步骤显示网站。
3. `tools.png` / `reading.png`：序号栏、折叠头层级、回答操作栏改为悬停才出现；
   reading 另有基线选择器。`tools.png` 图注「耗时都在行内」只对一半（单个工具
   耗时只在运行中与失败时显示）。
4. `projects.png` / `new.png` / `scheduled.png` / `search.png`：只有外壳过时。

## 前置修复（重拍前必做）

- `scripts/seed-screenshots.py:1182-1187` 往 `goals` 插入 v1 的列（`project_id`、
  `worker_limit`、`runtime_kind`、`write_mode`、`deadline_at`、`master_session_id`
  等），039 迁移重建后的表没有这些列，种子会失败。改按 `039_goal_v2.sql` 的
  `goals_v2` 结构写（`session_id`、`budget_seconds`、`continuation_count`、
  `created_via` 等）。
- playbook 的 goal 场景按 v1 写，要重写成 v2：一个会话、时间上限、模型宣告完成。

## 启动信号

任一即可：

1. UI 一轮大改收尾（Settings 逐页第二段与暗色复查做完），外壳短期内不再变；
2. 有用户或社区反馈截图与实物对不上（尤其 Goal）；
3. Goal 或运行区再改版，`goal.png` / `hero.png` 偏差继续扩大。

## 方案

先修种子与 playbook，再照 v2 playbook（mv-swap 隔离、1600 × 1000、zh / en 各一套）
由 JC 实拍；可按上面的优先级分批，先 `goal` + `hero`。图注随图一起改。

同日版式打磨（[devlog](../../docs/devlog/2026-10-07-readme-visual-pass.md)）并进来的
版面改动，重拍时一起做：

- 导览从 2×3 小图网格（每张约 370px，手机上约 150px）改成大图逐张，或只裁能证明
  卖点的局部特写；
- 补深色版截图（导览现在只有浅色图，深色模式下是 6 块浅色图块）；
- 一段 20–40 秒真实任务的演示视频，经 user-attachments 上传的 mp4 能在 README 里内联播放。
