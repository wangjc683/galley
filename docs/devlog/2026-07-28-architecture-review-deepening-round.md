# 架构审查第二轮:四个 Strong 候选全部落地(scheduler seam / side-question / useMessageSend / baseline gate)

- **日期**:2026-07-27 → 2026-07-28
- **Commits**:`f86d74ae`(scheduler)、`28b6df7b`(composer 政策)、`1344e8a3`(useMessageSend)、本 entry 同 commit(baseline gate)
- **方法**:`/improve-codebase-architecture` 三路 Explore 并行勘察(scheduled tasks / GUI 会话区 / Core·runner·managed-GA),产出 HTML 审查报告(7 候选 + 6 quick wins)。吸取 ADR-0002 教训:两个最有分量的断言(`/btw` 判定不一致、时间戳格式分歧)在写进报告前**亲手读代码核验**,全部属实。

## 候选 1:scheduler fire 路径进 HandlerCtx seam(`f86d74ae`)

审查发现 scheduler 本体 deep(interface 一行 `start(app)`)但三处绕开自家 seam:`DbSource::Global`(手里已有 pool)、`app.emit` 绕过 `Notifier`、`session.new` 结果裸 JSON 挖字段。修复后 `fire(ctx, task, now)` 全走 `HandlerCtx`,`socket_write_handlers_test` 同款 harness 直接可用。

无测试区里躺着三个真缺陷,一并修掉:

1. **时间戳字典序比较在 exact-second tie 上翻转**:`created_at` 写 `+00:00`(`db/helpers.rs`)、fire stamp 写 `Z`(`api/schedule.rs`),`due_fire` 却按注释"ISO Z 字符串可字典序比较"直接比串(`'Z' > '+'`)。修法双管:`due_fire` 改 parse 后按秒比较(对两种历史格式免疫),`instant_to_utc_iso` 统一输出 `+00:00` 与全库时间列一致。**否决过**只统一格式不改比较——旧库里已写入的 `Z` stamp 仍会踩同一坑。
2. **一行坏数据停摆所有任务**:list 读取 `collect::<Result>` fail-all,而 `due_fire` 里的防御分支假装 per-task 容错(死分支)。定策:list 逐行容错(跳过 + log),单行 fetch 保持响错;GUI 与 scheduler 同受益。
3. **re-enable 语义未记录**:重新启用不重置基线,当天未消耗周期立即触发。定为 contract,模块头注释 + 测试钉住。

`session.new` 结果引入共享类型 `protocol::SessionNewResult`(生产 handler 与 scheduler 同用,rename 变编译错)。这与 CONTEXT.md"unary result 保持 `Value`"并不矛盾——那条是 **CLI 侧** reprint 免掉字段的理由;进程内消费者是例外。CONTEXT.md 已补注。

## 候选 2:composer 政策进 lib/(`28b6df7b`)

- `/btw` 判定两处写法不一致是**真 bug**:Composer 含 `\t` 分支、`useMessageSend` 没有,`"/btw\tfoo"` 过了 stop 闸却按主 agent 消息发给运行中的 agent。修法先找**权威**:bridge 的判定(`workbench_bridge.py` dispatch UserMessageCommand 分支)才是事实源,GUI 单一 module `lib/side-question.ts` 精确镜像它(含拒绝 `/btw\n`——bridge 也不认)。
- hint 阶梯(`ee73b4b9` 刚重写的 5 层三元)抽成 `lib/composer-hint.ts` 纯函数,与 placeholder 政策(`composer-register.ts`)同一 seam;三态交接论述从组件注释升格为政策模块文档。CONTEXT.md 新增 "Side question (`/btw`)" 词条记权威链。

## 候选 3:useMessageSend 21 参收到 5(`1344e8a3`)

核心判断:**注入 12 个 store action 是假隔离**——hook 体内本来就在 6 处 `getState()` 直读 store,注入只买到宽 interface 和 `pendingAskUser: unknown` 的类型丢失。改为事件处理器统一调用时 `getState()`(消除闭包过期,`handleApprove` deps 缩到 `[copy]`),interface 只剩 App 真正拥有的五个值。

同文件两台 send-phase 状态机合并为模块级 `ensureBridgeThenSend`。**有意的行为统一**:空屏路径原来 replay 失败一次即抛错,现在与主路径一致先静默重启 bridge 再试。双政策没有 contract 依据(对照 ADR-0002 检查过——不是 frozen contract,是历史演化的意外分叉),取更健壮者。机器导出并配 6 用例——hooks/ 目录 2900 行里的第一个测试。

## 候选 4:GA baseline 元数据单源化(本 commit)

`5554d278`"Sync remaining GA baseline references missed by drift gate"暴露的结构性问题:SHA 复制约 9 处、gate 只查 4 处、40 位全 SHA 正则永远匹配不上短 SHA 和注释。修法三件:

1. `manifest.json` `upstream` 块补 `commitDate`(`gaCommitDate` 此前**构造上不可验证**——无源可比)与 `treeHash`。
2. gate 改"生成 + 校验":`--write` 生成 `gui/src/lib/ga-baseline.gen.ts`,`defaults.ts` 改 import——该文件彻底退出手动同步清单;默认模式字节比对 + 六项文档检查,含 **project-status.md 必须出现当前短 SHA**(历史 SHA 无害:升级后旧散文自然不含新短 SHA,该红就红。**否决过** delimited block 方案——为散文加标记块的维护成本高于"当前短 SHA 存在"这一充分检查)。
3. diagnostics test fixture 去真 SHA 改合成值:被测 adapter baseline 无关,真 SHA 只制造假同步义务——其 `auditedAt`/`patchCount` 早已漂移而无人察觉,恰是证明。

升级 SOP 手动面从 5 处收到 3 处文档散文,全部 CI 兜底。两条 gate 失败路径做过负向实测。

## 未做(见 deferred.md「架构审查第二轮剩余候选」)

候选 5(hive Origin carrier)、6(useComposerGoal goalView)、7(GaSession grep gate)与 6 条 quick wins 记入台账。
