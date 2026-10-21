# README 改成私人助理的叙事，截图第三版由主会话代拍

日期：2026-10-21
关联：[助手 PRD](../../.scratch/assistant/PRD.md) 裁决 1、7；[截图 playbook](../screenshot-playbook.md)「代拍」与「v3 偏差」两节；
票 [`.scratch/readme-screenshots-v3/issues/01-seed-main-chat-hero.md`](../../.scratch/readme-screenshots-v3/issues/01-seed-main-chat-hero.md)；
上一轮 README：[2026-10-07 刷新](./2026-10-07-readme-refresh.md)、[版式打磨](./2026-10-07-readme-visual-pass.md)。

## 起因

JC 先口述了一段产品形态（BYOK 的 MIT 开源全能私人助理，桌面为核心，登录态真实浏览器，主对话的 IM 体验，移动端同步，
工作台做深度会话，Sign in with ChatGPT，Less harness. More model.，local first），要一起梳理、找遗漏、形成一段介绍；
随后定在发版前把 README 改好，中文为准，定稿后同步英文。

## 梳理时的对表结论

- 方向自洽：登录态浏览器、手机只呈现桌面、不做云端 VM、否掉内嵌 CPA，都能从「助理住在你的电脑上」推出来。
- 要说准的：手机同步的是主对话与工作台会话，不含 IM（10-21 维持 IM 自己养 agent）；工作台是助理团队的办公室，
  不只是「传统 Agent」；local first 不写「数据不出你的电脑」（主对话 PRD）。
- **认错**：主会话先说「主动」与 D3「不发主动建议」冲突、建议别用。漏查了 10-19 裁决 112（它自己判断要不要跟进）
  与助手 PRD 裁决 9 里 JC 的原话「至少已经有主动提醒，主动给用户发消息」。更正为：「主动」可用，界线是不做后台生成的建议。
- README 现状：门面整段停在 09-09 的「单 agent + 团队编排」；IM 卡「同一个助手」与 10-21 的如实口径冲突；
  Quick Start 还是「ChatGPT / Codex」；「为什么叫 Galley」是 Supervisor 管团队的旧叙事；截图全部早于主对话。

## 裁决（JC）

1. **五条推荐一次照准**（「按你推荐推进」）：亮点分三组（一个助理，事事有交代 / 能真正做事 / 工作台和更多入口），
   「两组各 6 张」是表格排版时的约束，10-07 改成单列清单后已不存在；iPhone App 只在亮点第一组写一条、标「开发中」；
   信任那句只写可证的「过程随时看得见，想接手就接手」，不写「对外、付款、删除先问你」（是手册第二档的规矩，靠模型遵守、
   无硬闸，子任务路径没验证过）；「Supervisor 与聊天软件」改名「接入外部 Agent」，Supervisor 留作集成语境的术语。
2. **「Galley 是什么」取 B：加粗首句 + 三条要点**（能动手 / 只跟一个人说话 / 押注模型）。主会话推荐 A（三个一行的短段），
   JC 看了并排预览选 B：「有加粗有视觉层级关系，更易读」。三段长句的病在一半与亮点重复，删掉重复后再给层级。
3. **截图六格填满**：第三排空一格浪费，新拍 `todos.png`（待办面板）放第一排与工作台成对。没选：hero 再放一次（一屏上方刚看过）、
   底部 `new.png` 挪进网格（题词不替卖点作证）、删到四张（少一个卖点的证据）。
4. **hero 不现场跑**：JC「主对话里进度显示很少，直接给主对话的截图就行」。现场试过一次，句子漏了城市，助理先反问
   「在哪个城市」——问得对；以后若再现场跑，句子要自带地点与时间。
5. **剩余五张一起重拍**，并先调种子的侧栏（JC 选 A）：侧栏在每张图都入镜，私人助理的定位下第一眼不该是写代码。
   置顶从「面试准备：手写并发限流 + 防抖」换成「家里的保单和续费日期」；新增「查上个月的网购订单，哪些还没确认收货」
   体现登录态浏览器；「九月搬家」改「搬新家」，名字不带月份免得过期。没选 B（围绕助理整套重写，阅读面板改打开报销单 CSV）。
6. **`scheduled.png` 改拍法**：有主对话时侧栏没有「定时」入口、定时对话框打不开（主对话 PRD 裁决 91），改拍定时任务跑出的
   「昨日支出汇总」加待办面板的「例行」组；`reading.png` 走 ⌘K「查看仓库改动」（种子项目没绑仓库，顶栏没有按钮）。
   图里已没有「项目视图」，图注改「项目」。tools 定展开版（过程三行可见，对上「每一步都看得见」）。

## 种子里的真实公司

票 01 的子代理按场景把汇报写成具体公司名，种子沿用 v2 的三家真实上海搬家公司，配上编造的价格与「丢件」差评，
会进公开 README。「丢件差评」那句是主会话写进场景设计的。验收时改成虚构的青檀、木棉、橘子（en：Qingtan、Mumian、Juzi），
差评换成伤害更轻的「临时加价」。以后种子里出现第三方名字，默认虚构，且不写负面事实。

## 代拍

JC 问拍摄能不能交给主会话。做法写进 playbook「代拍」一节：Quartz 找窗口号后 `screencapture -l` 截带阴影的窗口；
点按钮用 System Events，点侧栏行用 Quartz 真实鼠标事件；走一次引导后把数据目录存成模板，每套语言从模板恢复再跑种子，
英文套直接在模板库写 `language_preference`。JC 只做了模型配置（最后用自定义服务商，没走 ChatGPT 授权）和挑图。
中英各 9 张，单张 216–493KB。

拍摄中出的错，都没有造成损失：

- 停 dev 的一条命令用 awk 收集进程树，数组一被查询就生成条目，把系统里所有父进程号都列进了 `kill` 名单（含 launchd、
  微信、浏览器）；名单里混进的表头「PPID」让 `kill` 整条失败，核对各应用启动时间都没变。之后只用带仓库路径的
  `pgrep -f` 精确匹配、先列出再发信号（playbook 已写）。
- System Events 的 `click at` 是无障碍「按下」，命中外层容器时按到了别的子元素（点 galley-site 打开了「筹备读书会」）。
- 第二轮开拍前没存 JC 的剪贴板，结束时里面是最后粘贴的「sort」，原内容丢了。

## 同步

- `README.zh-CN.md` / `README.md`、`docs/screenshots/{zh,en}/` 9 + 9 张（新增 `todos.png`）、`scripts/seed-screenshots.py`、
  `docs/screenshot-playbook.md`。
- deferred「README 截图第三版（重拍）」随本篇关闭、从台账删除；`.scratch/readme-screenshots-v3/` 的 PRD 与票 01 标 done。
- project-status「Do at release」：README 两条已完成；GitHub About 的「助手 → 助理」仍在，发版时问 JC。

## 没做

- README 里的工作台截图（reading、projects、search）仍用 v2 的种子会话，Dev 内容退到置顶之外但没删；整套种子围绕助理重写
  （上面裁决 5 的 B）没排期。
- 20–40 秒演示视频（10-07 版式打磨的第三层）仍未做。
- README 是新叙事的第一个落点，但另外几处一句话定位还没同步：宪法 Product Shape（`AGENTS.md`）、`docs/PRD.md` §1 / §3、
  `docs/project-status.md` 的「Product shape: dual-native local agent team orchestrator」。宪法那处是助手 PRD 的待定项，
  改之前要先问 JC。
- 推送：JC 定 README 随发版一起推（新 README 写的主对话功能 v0.6.2 没有），提交时没有 push。
