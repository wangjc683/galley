# PRD：README 截图第三版（重拍）

Status: needs-triage（暂缓，2026-10-07 JC 裁决：截图先不动，不重拍）
Date: 2026-10-07
来源：README 全面排查（2026-10-07），文字已按审计结论改完，截图与图注原样保留
关联：[deferred「README 截图第三版」](../../docs/devlog/deferred.md) ·
[README 刷新 devlog](../../docs/devlog/2026-10-07-readme-refresh.md) ·
[截图 playbook](../../docs/screenshot-playbook.md) ·
[v2 拍摄计划 devlog](../../docs/devlog/2026-09-09-screenshot-set-v2-plan.md)
2026-10-21 更新：JC 裁决发版前只重拍 `hero`、`hero-dark`（主对话）和 `tools`（子任务），
zh / en 各一套，其余五张暂留；见 [票 01](./issues/01-seed-main-chat-hero.md)。

## 问题

`docs/screenshots/{en,zh}/` 的 18 张图全部来自 `bb92398a`（2026-09-09），之后
`gui/src` 有 76 个提交。每张都过时的外壳：侧栏 masthead 与通栏新对话行（v0.6.0）、
SOP 入口挪到顶栏、「已完成 · 」前缀改对勾圈、顶栏「显示」弹层与浏览器控制 /
聊天软件指示灯、输入框 ＋ 菜单与推理强度。

逐张（按重拍优先级）：

1. `goal.png`：语义最过时。画面是 v1 的「3 个 Agent · 预算 30 分钟」与三条并行
   线；v2 是单会话、委托装扮、时间上限。README 图注「章节标记 / chapter markers」
   也已失效，本轮按 JC 裁决原样保留。（2026-10-13 Goal 移除后此图已删，不再重拍。）
2. `hero.png` / `hero-dark.png`：差异最大。两行实时窗口、步骤序号栏、思考预览、
   杏色气泡（暗色另调）、发送时间、浏览器步骤显示网站。
3. `tools.png` / `reading.png`：序号栏、折叠头层级、回答操作栏改为悬停才出现；
   reading 另有基线选择器。`tools.png` 图注「耗时都在行内」只对一半（单个工具
   耗时只在运行中与失败时显示）。
4. `projects.png` / `new.png` / `scheduled.png` / `search.png`：只有外壳过时。

## 前置修复（重拍前必做）

- ~~种子往 `goals` 插 v1 的列、playbook 的 goal 场景按 v1 写~~：已过时。
  2026-10-13 Goal 整体移除，`248e8d09` 同时删掉了种子的 goals 插入，`7ebbf696`
  把 playbook 里的 Goal 退役，`docs/screenshots/` 里也已没有 `goal.png`。
  2026-10-21 核实：种子 `--init-schema` 在迁移 001–052 上跑通，不再碰任何 Goal 表。
- 种子停在 043 之前（没有主对话、子任务、待办），v3 的 hero 拍不了：
  [票 01](./issues/01-seed-main-chat-hero.md) 补齐，playbook 的 hero / hero-dark /
  tools 三行随之改写。

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
