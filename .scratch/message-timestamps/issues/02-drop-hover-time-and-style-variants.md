# 02 砍掉悬停时间，常显样式改成三档切换

Status: done

接在票 01 之后（01 的改动还在工作区，未提交）。先读 `../PRD.md` 的「真机第一轮」和
「待真机裁决（第二轮）」两节。只改 `gui/`，不 commit。

## 改哪些文件

- `gui/src/components/conversation/MessageUser.tsx`
- `gui/src/components/conversation/Conversation.tsx`
- `gui/src/lib/message-time-variant.ts`（TEMP）
- `gui/src/components/conversation/TimeVariantPill.tsx`（TEMP）
- 如有必要：`gui/src/lib/message-time.ts` 及其测试（只在注释或导出需要跟着变时）

## 怎么改

1. **悬停时间整个删掉（正式删除，不是 TEMP 开关）**：
   - `MessageUser`：删 `HoverMessageTime`、`hoverTime` 参数、三个放法分支、
     `hoverPlacement` 及相关 import。
   - 复制按钮外层那个绝对定位 div **恢复成票 01 之前的原样**（去掉
     `flex items-center gap-1.5`），它上方那段注释里 2026-09-28 加的 hover 段也删掉。
     用 `git diff` 对照，确保这一处回到 HEAD 的样子。
   - `Conversation`：不再传 `hoverTime`；非断点消息不需要格式化标签，可以只为 pinned
     的 turn 生成字符串。
2. **阈值固定 60 分钟**：`Conversation` 直接 `userTimeMarks(turns)`，去掉读切换器阈值
   的代码和 `breakThresholdMs`。`userTimeMarks` 的 `thresholdMs` 参数可以保留（测试在用）。
3. **常显样式三档（TEMP）**：切换器 store 改成只有一个 `style: "a" | "b" | "c"`，
   默认 `"b"`，localStorage 换一个新 key。
   - a：`text-[11.5px] text-ink-muted`（现状）
   - b：`text-ui-micro text-ink-muted`（10.5px）
   - c：`text-ui-micro text-ink-muted/70`
   - 三档都保留 `select-none leading-none [font-variant-numeric:tabular-nums]`，行距
     `mb-1` 不动。
   - `PinnedMessageTime` 从 store 读档位拼 class；`MessageUser` 和 `GoalCommissionMarker`
     都走它，所以自动一致。用 `cn()` 拼 class（`text-ui-micro` 已注册进
     tailwind-merge，不会被颜色 class 吞掉；拼完自己核对一下）。
   - 非开发构建一律用 b，不读 localStorage。
4. **切换器**：只剩一组「常显样式：现状 / 小一号 / 小一号淡」，其余形态、位置、portal
   做法不变。
5. **注释**：
   - `MessageUser` 顶部 2026-09-28 那段：删 Hover 小节，写明悬停时间已在真机第一轮砍掉，
     理由用 JC 原话「有点吵，也没有必要」；样式一句改成「字号与墨色待第二轮真机定」，
     别写死 11.5px。
   - `lib/message-time.ts` 模块注释里「on hover everywhere else」之类提到悬停的句子
     跟着改。
   - 所有临时代码继续带 `TEMP(message-timestamps)`。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui test
git diff --check
grep -rn -i "hover" gui/src/lib/message-time.ts gui/src/components/conversation/MessageUser.tsx
```

最后一条是自查：MessageUser 里与复制按钮本身相关的 hover 保留，与发送时间相关的不应剩下。

## 别动什么

- 不碰 `gui/` 以外；不改 `useDayStamp`、问题轨、`stores/messages.ts`（票 01 补的
  `createdAt` 保留）。
- 不对既有文件跑 `prettier --write` / `pnpm --dir gui format`，只保证自己的 hunk 风格一致。
- 不写 docs / devlog；不 commit；工作区里与本票无关的改动不要碰（`docs/devlog/deferred.md`、
  `.scratch/` 是主会话的）。

## 回报格式

1. 改动文件清单，每个一句话。
2. 票面没写清、你自己做的决定。
3. 验证输出尾部（含 grep 结果）。
4. 复制按钮容器是否已与 HEAD 一致（贴那几行的 `git diff`，应为空或只剩无关上下文）。
5. 注意到但没处理的边角。

## Comments

### 2026-09-28 实现（子代理，未提交）

- 已做：悬停时间正式删除（`HoverMessageTime`、`hoverTime` 参数、三个放法分支、`hoverPlacement`）；复制按钮容器及其上方注释回到 HEAD 原样（逐字比对一致，`git diff` 不再触及该区域）；Conversation 固定 `userTimeMarks(turns)`，只为断点 turn 格式化标签；切换器只剩「常显样式：现状 / 小一号 / 小一号淡」，默认 b，新 key `galley_temp_message_time_style`，非开发构建恒为 b、不读 localStorage；`PinnedMessageTime` 按档位拼 class，MessageUser 与 GoalCommissionMarker 自动一致。
- 核对 class：tailwind-merge 在字号 class 排在 `leading-none` 之后时会吞掉 `leading-none`（node 实测），所以写成 `cn(档位, 基础)`；三档拼完都保留 `select-none leading-none tabular-nums`，字号与颜色互不吞。
- 没动：`GoalRunMarkers.tsx` 的 prop 注释仍写「No hover time here in v1.」（不在本票文件清单）；开发机 localStorage 里第一轮的旧 key 还在，无害。
