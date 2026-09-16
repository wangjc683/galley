# live run 改成固定大小的两行窗口：密度按状态分流

日期：2026-09-16
关联：[PRD](../../.scratch/live-run-window/PRD.md)、
[步号淡一档 devlog](./2026-09-16-step-marker-recede-and-reference-audit.md)
后记七至九（三刀的失败史）、[run fold devlog](./2026-08-06-conversation-run-fold.md)、
`Conversation.tsx` / `RunFoldHeader.tsx` / `run-groups.ts` / `MainView.tsx`

## 起因

同日三次在同一套过程区排版上提密度（数值刀 55→47、单行合并刀 55→31）
都被 JC 真机否决：「太密集后，单个步骤的阅读体验其实变得更差了」。agent
的判断：密度与阅读体验在一套静态排版里无解，层级靠墨量、字号、折叠，
不靠挤压；已落的两样够了，缺的是折叠没覆盖 live 与刚完成两个窗口。先落了
「完成即折」（重审 08-06 keep-expanded）。

随后 JC 提出：每一步完成就折，自始至终只显示一个。

## 设计讨论

agent 认可并修正为**两行窗口**：step 的 summary 在 turn_end 才产生，只留
进行中行等于永远读不到任何一句 summary。窗口 = 上一步落定的 step（阅读
形态原样）+ 进行中行；之前的步折进 live 头。它一次解决三件事：live 空间
恒定；完成即折的滚动跳变从 500px 级降到两行；思考行不再是「没有序号的
步」而是面板主角。

面板排版逐条（JC 全部认可，头文案取「已完成 N 步」）：头复用 RunFoldHeader
（live 变体，不带用时——第三只表）；头在第一步折进去时出现；窗口滑动
同帧三件事（盖章、上一步收进头、新思考行出现）；live 展开是 opt-in 且完成
时保持；注意力态原样进面板；rail 贯通；中止全展；只做可折 run；不新增
寄存器。

## 落地

见 PRD「实现」节。要点一个：窗口 region 的间距归属改由 region 承担
（marker `mt-*` 经 `data-role` 归零），因为挂着的 0fr fold section 会阻断
margin 穿透，否则展开 / 收起时头到窗口的间距会抖 10px。

完成瞬间的收合（JC 当场追加）：live 与 settled 结构在窗口上没有共同 key，
同一次渲染切换会让两行瞬时消失。解法是把结构切换延后一次 sweep——run
完成的那次渲染用 guarded setState-in-render 标记 `settlingOpener`，保持 live
结构但窗口的 ExpandSection 关闭、头当场换 settled 文案、closing turn 不进
窗口而平铺在下；300ms 后切到 settled 结构，此时折叠段本就关着，画面不再动。
窗口的 ExpandSection 顺带接管了头到窗口的间距编排（折叠头下 `-mt-2.5` +
`pt-2.5`，padding 在 overflow 盒内让 rail 穿过间隙）。

`.scratch/conversation-run-fold/PRD.md` §2 再修订；deferred「live 状态升为
顶部 live header」被本设计吸收后删除。

## 数据

本机 workbench.db 348 个 run：1 步 57%、2–3 步 18%、4–5 步 10%、6–10 步
11%、11–20 步 4%、21+ 1%；8 月 15 日后 55 个 run 中 5 个超过 10 步，最长
52。单步 run 完全不受本设计影响。

## 待真机验

完成瞬间「头瞬换文案 + 窗口渐收」是否读作一个动作；快步连发的替换观感；
两步 run 的头闪现；760 列宽气味段截断。
