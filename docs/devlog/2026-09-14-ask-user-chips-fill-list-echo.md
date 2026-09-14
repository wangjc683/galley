# 2026-09-14 · ask_user 候选：填入慢路径、竖排列表、回显勾选

> Status: implemented · Related:
> `docs/design/conversation.md` §ask_user 提问气泡 ·
> `gui/src/lib/ask-user-candidates.ts` ·
> `gui/src/components/conversation/AskUserBubble.tsx` ·
> [上一篇：可选中 + softBreaks](./2026-09-14-ask-user-selectable-markdown.md)

## Context

可选中修完后 JC 问 AskUser 在 UI / UX 上还有什么可优化。核对现状后列了六条
（侧栏标记、通知、重启重建待答状态都已具备，问题全在交互细节）：

1. chip 点击即发送，误点无退路，也无法「选 B 改两个字」；
2. 纯键盘不可达（无序号、无数字键）；
3. 句子级候选横排 chip 读作标签云，且常与问题正文里的 A / B / C 重复；
4. 回显看不出当时有哪些候选、选了哪个；
5. chip 与 Composer 距离远，可考虑 quick-reply 条贴输入框（结构性，气质票）；
6. `AskUserBubble` 注释说重启后 chip 消失，但 store 已有 `derivePendingAskUser`。

JC 裁决：暂不考虑键盘用户（2 不做），5 挂起，做 1 + 3 + 4 + 6。

## Decisions

### D1. 快路径保留，慢路径走右键 / 修饰键，不动 store

点击发送是 chip 的价值，不改。慢路径 = 右键菜单「填入输入框」+ ⌘ / Ctrl +
点击，二者都调 `ComposerHandle.prefillText`（EmptyState 已在用的命令式接口），
MainView 新持一个 `composerRef`，不加 ui store 状态。右键是本应用已有的
桌面惯例（文件引用、侧栏行），不另发明悬浮副按钮以免 chip 变吵。
此前 deferred 的「chip 文字复制」由此覆盖，从台账拎出，scratch 04 关闭。

### D2. 候选排布按内容自适应，阈值是导出常量

`candidateLayout`：5 条以上、单条超 20 字、或合计超 60 字走竖排整行列表
（全文不截断、左对齐），否则行内 chip。否决「一律竖排」：「是 / 否」两条
竖排太重；否决「一律横排」：8-24 那条三句话横排就是标签云。阈值凭现有
库里的样本拍的，故导出常量，dogfood 后可调不用碰布局。同一函数同时喂
实时气泡和回显。

JC 真机：竖排比之前好，但行撑满对话列后短选项后面一大片空白。三个改法
里选了「列宽取最长一条」（容器收缩、各行拉齐），否决「每行按内容收缩」
（右缘参差、热区不一，列表感弱）和「去按钮皮肤改成标记 + 文字行」（是
重设计，留给与 option-desc 小字变体同一轮实测）。

### D3. 回显列候选、勾所选，判定用全文相等

`AnsweredAskUser` 新收 `candidates` + `answer`：候选 ink-muted 列出，
`chosenCandidateIndex` 全文相等（trim 后）命中的那条 ink-soft + Check。
自由回复或填入后改过的一律不勾——用户消息就在正下方，不需要猜。回复
定位 `askUserReplyContent` 复用 run-groups 的成员规则（ask_user 之后下一条
user turn 即回复，system 是旁观者）并直接吃 Conversation 现有的
`replySet`，避免第三套「谁回答了谁」的判定。不再给回显加 chip：交互已
结束，按钮会暗示可重答。

### D4. 修正过期注释

`AskUserBubble` 顶部「重启后 chip 消失」的说法已过期：messages store 恢复时
`pendingAskUser ?? derivePendingAskUser(turns)` 会在会话最后一句仍是未答
提问时重建完整实时面。注释改为描述现状。

## Verification

`pnpm --dir gui typecheck` / `lint` / `vitest`（新增
`ask-user-candidates.test.ts`：排布阈值、勾选判定、回复定位含 system 旁观与
被后续 run 取代）/ `git diff --check`。真机验收：右键与 ⌘ 点击填入、
长候选竖排、回显勾选，由 JC 用一个明确要求给三个候选的提问看。
