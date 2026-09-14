# 04 候选 chip 的文字复制（暂缓）

Status: needs-info
Date: 2026-09-14

## 背景

排查社区反馈「AskUser 不能复制文字」时浮出：问题正文已改走
MarkdownView 可选中（devlog 2026-09-14），chip 仍是按钮不可选，40 字
截断只在 tooltip 展示全文；想复制某个选项改几个字再回做不到。

## 为什么挂在本 PRD 下

与 02 的 tooltip / 小字变体争同一块 chip 面积，应一起裁，不单独开线。

## 启动信号与方案

见 `docs/devlog/deferred.md`「ask_user 候选 chip 的文字复制」。
