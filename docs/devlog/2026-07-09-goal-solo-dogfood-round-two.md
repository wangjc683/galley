# Goal solo 打磨轮二:过程可见 · 无项目 solo · 收口竞态 · Composer 入口

日期:2026-07-09
范围:commits `bf35060` → `30aeea2`(main),规范档案在 `.scratch/goal-solo-hive/`

JC 对 goal-solo-hive 首轮(`f0e9840`)dogfood 后提出三个问题,随后两轮真实
dogfood 又暴露两组运行时/交互缺陷。本条记录六个决策的"为什么"和被否方案。

## 1. solo 过程展示:深研形态 → 完整过程可见(方案 A)

首轮把 solo 工作 turn 全部 internal + 90s 心跳(深研形态),JC 反馈"反馈感差,
应像普通 session 一样展示工具调度"。勘探发现两个关键事实:

- 当初判"刷屏"的元凶是**续跑 nudge**(还叠加过已修复的瞬发 burst bug),
  agent turn 本身从来不是噪音源;"turn 可见 + nudge 隐藏"组合从未被试过。
- nudge 落库可见性(`send_message_with_visibility`)与派发给 runner 的
  `UserMessageCommand.visibility`(bridge 据此给 turn 事件盖章)是**两个独立
  开关**——拆开即可,GUI 零改动,直接复用普通 session 的 TurnMarker / 工具
  pill / 流式渲染的现成策展。

落地:nudge 仍 internal,turn 派发可见;90s 心跳整链删除;续跑 prompt 加
"每 turn 只留简短进展说明"。**被否:方案 B(默认折叠的"工作过程"组)**——
GUI 无折叠消息组件、需第三种可见性档位、live 事件门控与 SQL 恢复两层过滤都要
改,成本高一个量级;记为 A 试跑嫌吵后的 v2 退路。dogfood 证实 A 的密度健康
(约 10–50s 一个可见 turn)。

## 2. 无项目 solo:正经迁移,不走过滤 hack

solo 无项目发起保持无项目(issues/03,曾因数据风险回退)。勘探修正了 issue
的两个预估:024–032 **全是 additive**(级联删除风险比预想低);但 preflight
边界必须**连续**扩到 33(033 的 INSERT…SELECT 依赖 032 的 mode 列),且 spec
必须 `include_str!` 全文(checksum 按字节对齐 sqlx,放文件名/哈希都不行)。
两个易踩的坑:preflight 测试硬编码 `Applied { to: 23 }`;033 重建必须带上
030 的 `goals_single_active` partial UNIQUE(漏了就破坏单活跃约束)。
**被否:GUI 过滤 auto 项目的零风险替代**——解决侧边栏污染但 session 数据上
仍归属隐藏项目,非真·无项目。JC 的真实库升级实测顺利(备份 + preflight 全过)。

## 3. 收口竞态与超时策略(dogfood #5)

5 分钟 solo 实跑 13.5 分钟:`wait_master_final_answer` 拿 turn_index 与
**turn_count(不同计数器)**比且用 `>=`,1 秒前落地的工作 turn 冒充收口答案,
goal 在派发 synthesis 的同一秒标 completed;真收口 turn 泡在满屏"不能宣告
完成"语境里又磨了 8 分钟,无人 shutdown。与 dogfood #3 修过的 wait_solo_turn
是同类 bug——**同形等待逻辑分居两处导致漏改**(见 §6)。

修复(JC 拍板):严格 `>` 基线(纯函数 `master_final_answer_after`,hive 同
收益);solo 收口超时 = min(基数, max(120s, 预算/2));超时兜底 = 取最新 agent
输出 best-effort 标 completed + **shutdown master runner**。**被否:维持
Wrapping + CLI resume**(桌面用户无 resume 入口,是死路)和**标 failed**
(把有产出的运行报成失败)。收口 prompt 改硬终止指令("此前所有 keep going
作废")。pill 消失被证实是假 completed 的下游而非独立 bug(auto-mark-seen
by design)。

## 4. Composer Goal 入口:门控语义与几何稳定

四个"按钮时灵时不灵"的根因,两条原则沉淀:

- **GUI 门控语义必须对齐 DB 约束**:`hasActiveGoal` 曾用 `activeGoals.length`,
  但该列表含"已结束未查看"的 goal(为 pill 保留查看结果入口),而 DB 单活跃锁
  只锁 running/wrapping——结果每次 Goal 结束后按钮死一阵,tooltip 还误导。
- **控件几何稳定 > 视觉强调**:armed 态把发送圆钮变 116px 宽胶囊,在右对齐行里
  把切换钮往左顶 ~84px,指针底下的按钮滑走,二次点击落在(常为禁用态的)胶囊上
  静默无效。砍掉宽胶囊,armed 改原位圆钮变形(↑→◎),「启动 Goal」语义交给
  tooltip/底部快捷键提示。随之两钮同为 Target 图标,取消钮换 ×。
  **被否:整体取消 armed 模式**(单步直开确认框)——更彻底但丢掉目标式
  placeholder 引导,交互改动面大;先修几何,留作后续选项。
- 空状态启动时序:`setScreen("main")` 曾在会话建好、Goal 未启动时就翻屏,确认框
  连同转圈被卸载,数秒空白像卡死;改为启动落地后再翻屏,失败留在原地可重试。

## 5. controller.rs 拆分(2356 行 → 4 模块)

拆的理由不是行数,是 §3 展示的实害:两台引擎物理混编,同类等待逻辑相距一千行。
沿现成接缝纯机械搬迁:`controller.rs`(入口 preamble + 分发 + 共享工具 +
`#[cfg(test)]` re-export 门面,273 行)、`hive.rs`、`solo.rs`、`finish.rs`。
`mod.rs`/`tests.rs` 引用面零改动(沿用 signals/decision 已有的门面惯例)。

## 6. 待验证 / 遗留

- dogfood #6:到点一个 turn 内收口、completed 后线程安静(修复已合,待实跑)。
- Composer 新几何与 ×/◎ 图标的视觉验收。
- synthesis 超时诊断串保留英文(有意:含 session id 与 resume 命令,属诊断)。
- solo→hive 自动升级、折叠工作过程组:均为记录在案的 v2 项。
