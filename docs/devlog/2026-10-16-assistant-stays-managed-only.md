# 助理维持只在内置内核：外置要改的是宪法，不是开关

日期：2026-10-16
关联：[主对话 PRD](../../.scratch/main-chat/PRD.md) 裁决 3、[助手 PRD](../../.scratch/assistant/PRD.md)（D5「一个人」）、宪法 Rule 1

## 起因

JC：「我们现在主对话功能是只有内置 GA 用户才能使用对吧？如果要扩展到外接 GA 用户也可以使用，在架构上工作量大吗？有没有什么潜在风险和问题？」

## 现状：三层门

1. 产品：主对话 PRD 裁决 3（10-09）「只在内置内核提供……与『内置优先』一致」。
2. 数据：`sessions` 表 CHECK `main_chat = 0 OR ga_runtime_kind = 'managed'`，外加全表唯一的主对话索引。
3. 引擎（根子）：助理之所以是助理，全靠 Core 拼的提示词（运行时说明 + 主对话一节 + 入口层，`core/src/managed_prompt.rs` 的 `compose_main_chat_runtime_prompt`），经 GA 后端的 `extra_sys_prompt` 装入，只在内置时装（`runner/workbench_bridge.py` 的 `_install_managed_prompt_profile`）。外置会话今天不注入任何 Galley 提示词。

## 卡点：Rule 1

外置模式「Do not inject Galley Persona or managed-runtime patches」。助理就是一个 Galley 人格加一本操作手册；允许的接入点里没有写系统提示词，`extra_sys_prompt` 是 GA 自己的属性、不是 Galley 命名空间的。先例里的修宪（外置图片附件的一次性包装）有上游 `frontends/desktop_bridge.py` 同款做法作依据，注入人格在上游没有对应物。

## 硬做的代码量

一两千行量级（粗估，没拆票）：重建 `sessions` 表放宽 CHECK（加六处手写迁移列表）；runner 外置也装提示词、助理手册改放 Galley 自己的数据目录；重置在外置下不能碰 GA 记忆（`core/src/main_chat_reset.rs` 第 1 步本就拒绝非内置、第 3 步换回记忆种子）；主对话的模型从内置 `llm_key` 改为另一套适配 GA `mykey.py` 列表；GUI 各状态；入口层真模型评测在外置 GA 上再跑一套。

## 风险（比代码量要紧）

1. 外置模式的承诺是「Galley 只包裹，不改你的 GA」，这是有人选外置的理由；修 Rule 1 就是在这条承诺上开口子。
2. 记忆串味：助理靠 GA 长期记忆记住你；外置时那是用户自己的 GA 记忆，在 Galley 之外也会读，模型会把 Galley 人格、galley CLI 用法、派活标签记进去。Rule 1 禁 Galley 写 GA 记忆，由 Galley 提示词指使模型去写是同一件事的间接版本。先例：项目记忆在外置模式不启用。
3. 重置语义破了：外置下只能删对话，助理照样记得你。
4. 版本不受控：`extra_sys_prompt`、历史回放的形状（`runner/ga_session.py` 只对两种后端类验证过）、分段续接都靠 GA 内部；上游一改，坏的是一条永远在的对话。
5. 与 D5「一个人」冲突：库里只能有一个主对话，两种模式间切换时要么同一条对话背后换了记忆不同的引擎，要么两种模式各一个助理。
6. 外置的助理会缩水：IM 渠道是内置进程，浏览器插件桥是内置补丁，项目记忆不启用。
7. 助理以后每一步（承诺、授权补全、IM 并入）都要多问一句外置怎么办。

## 三条路与裁决

- **A 维持只在内置**（推荐，JC：「认可，维持只在内置」）。定位（2026-07-03）：内置是产品引擎，外置是兼容模式。
- B 修宪、外置也注入（只给主对话、只在内存）：风险 2、3、5、6 修宪也解不掉。
- C 绕道：把入口层塞进用户消息（字面合规、实质同一件事，且写进 GA 历史与记忆）；或照 Supervisor SOP 让用户自己把手册复制进 GA（GA 的记忆与 SOP 是全局的，在 Galley 外用 GA 时它也以为自己是 Galley 的助理）。

外置用户真正的门槛是切到内置的代价：设置里有「切换到内置内核」，但没有从外置 `mykey.py` 导入模型、把外置记忆带过来的入口。这条「搬家路径」只读外置、写内置，Rule 1 允许；没有数据说明外置用户有多少、要不要助理，记进 [deferred](./deferred.md)「外置用户搬到内置」，等信号。
