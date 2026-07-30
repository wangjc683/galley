# 05: Windows smoke 验证轮

Status: ready-for-agent
Blocked by: 02, 03, 04

## 背景

图片拖放整体迁到 Tauri 原生事件后，Windows（WebView2）是最大回归面，
且 composer 有 focus 旧账（`.scratch/win-composer-focus/`）。
JC 裁决：agent 跑 smoke 清单即可，JC 在发新版本时做 Windows dogfood 终验。

## 清单（在 Windows 环境按 docs 索引的 Windows smoke 流程执行，外加本 feature 专项）

- [ ] 图片拖放回归：单张/多张/超限 toast/overlay。
- [ ] 非图片文件与文件夹拖放：占位符插入、发送展开。
- [ ] 反斜杠路径（`C:\Users\...`）展开与引号规则正确。
- [ ] 纯文本 / URL 拖拽不被原生事件吞掉。
- [ ] 拖放与 composer focus 行为无交互问题（对照 win-composer-focus 的
      历史症状）。
- [ ] picker「引用文件…」在 Windows 原生对话框下正常。

## 产出

结果记录追加到本文件 `## Comments`；发现的缺陷各自开新 issue。
