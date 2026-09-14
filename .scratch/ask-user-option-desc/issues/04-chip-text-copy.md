# 04 候选 chip 的文字复制（已由「填入输入框」覆盖）

Status: wontfix
Date: 2026-09-14

## 结论

2026-09-14 同日实现了 chip 的慢路径：右键「填入输入框」或 ⌘ / Ctrl + 点击
把候选全文填进 Composer 不发送（devlog
`2026-09-14-ask-user-chips-fill-list-echo.md`）。「选 B 但改两个字」的
需求由此覆盖，单独的「复制 chip 文字」不再需要。

## 给 02 的约束

候选现在有行内 chip / 竖排列表两种排布（`lib/ask-user-candidates.ts`），
02 的 tooltip / 小字变体要在两种排布下都成立；竖排列表天然能容纳
desc 小字行，tooltip 在竖排下意义变弱。
