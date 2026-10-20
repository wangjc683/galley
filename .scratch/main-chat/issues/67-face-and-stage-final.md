# 67 定稿：拆幅度档与演示，丙加舞台 72 加 1 倍的脸进生产，设计文档定稿

Status: done（2026-10-20 JC 真机通过：「票 67 真机看了，通过」。合入 `4c16790d`、`1e435e06`、`d8dbfd76`；主会话复跑门禁：typecheck、lint、`TZ=UTC` 与 `TZ=America/Los_Angeles` 各 1945 条测试全过、`pnpm --dir gui build`、`git diff --check`、文档链接门禁，「票 65 / 66」清零，新增行没有本机路径；合入后 touch `gui/index.html`，dev 服务器给出的 `App.tsx` 已接正式驱动。屏幕锁着没截到真机窗口，真机看一眼即可）

来源：主聊天 PRD 裁决 117、118、119（2026-10-20，JC 真机比完票 66：「幅度太大的确不太适合 Galley 的气质，这三档看肯定是 1x 比较合适」，裁决 119 第 7 条）。依赖 66（已合入）。改 GUI 与文档；Core、runner、CLI 不动。

## 一、进生产

- 内置运行时、有主对话时，侧栏的助理卡片就是**居中舞台 72**，头像是**会动的脸（丙）**，幅度 **1 倍**：票 65、66 在开发版里做的样子原样进生产构建。
- 外置运行时没有主对话，逐像素不变。
- 顶栏身份行的 28px 头像一律静止（裁决 119 第 6 条）；在跑时照旧有它的徽标与下面那行字。
- `prefers-reduced-motion`：脸不动，在跑时转圈徽标放回（票 65 的做法）。
- 原来生产里的「现状」（40px 行式卡片、在跑时头像角上转圈）在内置运行时拆掉；只在减少动态下用到的转圈徽标留下。拆之前 `grep` 一遍，静止头像组件（`AssistantAvatar`）还有谁在用，用到的留。

## 二、拆掉

- 切换器（`assistant/face-trial/` 的 pill）、幅度档（1× / 1.5× / 2× 的乘数，定成 1 倍常量，乘法本身删掉）、演示（轮播、钉住、「看网页一分钟不换」）与它们的测试、文案、localStorage 键。`grep -rn "票 6[56]" gui/src` 清零。
- 驱动（`AssistantFaceDriver`）挪出 `face-trial/`，成为正式的一部分，名字去掉 trial。
- 拆的时候别把有用的测试一起删了：占比（干活 ≥95%、丙闲着 ≤5%）、静止逐像素、减少动态、外置不受影响、事件 → 状态的映射、长活安静下来，这些改成守生产路径。

## 三、设计文档定稿

- **`docs/design/foundations.md` §2.7**：加「助理的脸」豁免，写清：
  - 只限侧栏助理卡片的头像（顶栏 28px 静止），同一时刻只有一张脸在动；
  - 只在它有状态时动，每个动作一句话说得清在表达什么（状态表照裁决 117 第 3 条、119 第 4 条，以代码为准）；
  - 扫一眼分得出在忙：干活时 ≥95% 的时间在动、不停超过约 1 秒，丙闲着 ≤5%；守住侧栏「只有 running 会动」；
  - 长活安静下来（15 秒后约四成、20–30 秒一拍全幅）；
  - 幅度 1 倍，数值集中在 `gui/src/lib/assistant-face-motion.ts` 的 `MOTION`；为什么用 SMIL（票 65：CSS / Web Animations 在跑时把整张 SVG 错开半个设备像素）；
  - 减少动态下静止、在跑时转圈徽标回来；窗口不在前台时暂停。
  - 来源写 PRD 裁决 117、118、119，票 65、66。
- **`docs/design/layout-and-chrome.md` §4.2「有主对话时」**：助手卡片的构造改成舞台 72（尺寸、助理区实测高度、头像居中、名字加小字时间、第二行规则照旧、选中是头像外品牌色描边加名字满墨、不铺底、悬停与按下、未读徽标的尺寸、侧栏窄于 184px 时头像 48、跳出圆框的空间）；「头像」一条补上「会动的脸」并链到 §2.7；「在跑时说什么」里「头像转圈」改实；示意图跟着改。§4.1 顶栏身份行写明头像静止。历史段落照这份文档的写法保留一句「2026-10-14 至 10-20 是 IM 行式卡片（裁决 65）」。
- **`docs/ipc-protocol.md` §4.4 `tool_call_start`**：runner 实际不发（只在 `runner/ipc.py` 定义），照代码写实：标明现状、GUI 从哪里拿正在调的工具（票 65 回报：读本步原始流里 GA 的派发行，`gui/src/lib/assistant-face.ts`）。不改协议本身。
- 文档里引用的 `file:line` 都以合入时的代码为准。

## 别动

- Core、runner、CLI、`managed-ga/code`；母图与应用图标文件。
- 脸的动作、数值（1 倍档原样）；侧栏 C 档；主区。
- 主工作树：只在自己的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk。React 编译器 lint 规则同前两票。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`（带条数）。
- **生产构建**：`pnpm --dir gui build` 通过；用构建产物（不是 dev）在 harness 里截一张舞台卡片、一张外置运行时，确认生产里就是定稿的样子、外置不变、没有 pill。
- 截图放 scratchpad，文件名带 `t67-` 前缀；自己起的 Vite / 浏览器 / 静态服务全部停掉。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 拆了什么、留了什么（尤其静止头像与转圈徽标还在哪用）。
3. 生产路径怎么接的（`file:line`）。
4. 三份文档改了哪几节，各一两句。
5. 验证命令与结果原样（测试条数、两个时区、build）。
6. 截图路径。
7. 看到但没改的问题。

## 给 JC 的真机步骤

只改 GUI 与文档，dev 已整页重载。

1. 侧栏助理卡片是居中舞台 72，脸照 1 倍在动，和票 66 的 1× 一样；主区顶栏下沿不再有 pill。
2. 让它干点活，脸在侧栏动、顶栏的小头像不动。
3. 已知（代理回报）：还没有任何消息时卡片没有第二行（110px），第二行出现时列表下移约 19px，只在新主对话问候落地前遇到；`docs/ipc-protocol.md` §4.5 `tool_call_end`、§4.6 `tool_call_progress` 同样只定义、runner 不发，这次只改了 §4.4。

## Comments

- 2026-10-20（实现子代理）：已在分支 `main-chat-67-face-final`（基点 `625ea380`）做完，代码一个提交 `c30406c8`，设计文档一个提交 `5b92ce74`，本说明一个提交，待主会话合入与 JC 真机。
  - **拆了什么**：`assistant/face-trial/` 整个文件夹（pill、幅度 1× / 1.5× / 2×、演示与它的 22 个状态、`galley.tmp.faceTrial.*` 三个本机键、`face-trial.test.tsx`）；`face-smil.ts` 里幅度的乘法（`displayPose`、`partAnimation`、`displayedField` 不再带 `amp`），`AssistantFace` 与 `AssistantAvatar` 的 `amplitude` 与 `data-amplitude`；导演只给演示用的 `playNext`、`currentActivity`（`freshen` 改成私有）；store 的 `demoLabel`；`MOTION.demoStepMs`；驱动 hook 的 `demo` 与 `alive` 两个选项（驱动一律 `setAlive(true)`，即丙）；内置运行时原来生产里的 40px 行式卡片（`cardFill`、固定 58px、选中三通道）。`grep -rn "票 6[56]" gui/src` 为空，`Sidebar.main-chat.test.tsx` 的「遗留清单」加上了这些名字与「票 65」「票 66」，守着不回来。
  - **留了什么**：静止头像（`AssistantAvatar` 不带 `animated`）只剩顶栏身份行在用（`AssistantIdentity.tsx:60`，28px），留着；40 这个尺寸没人用了，删掉，尺寸是 28 / 48 / 72。转圈徽标留着，只在减少动态下出现（`AssistantAvatar.tsx:156`，`faceRuns={!reducedMotion}`，`SidebarAssistant.tsx:272`）；徽标尺寸只剩舞台的 48 / 72（新类型 `AssistantBadgeSize`），28 / 40 两档没人用，删掉。导演的 `setAlive(false)`（乙）没删：占比测试拿它对照「乙闲着 0%」，只是驱动不再用。`SPATIAL_FIELDS`、`scalePose`、`scaleBeat` 留着，长活安静下来靠它们乘 0.4。
  - **驱动挪出来**：`face-trial/AssistantFaceDriver.tsx` → `assistant/AssistantFaceDriver.tsx`，只调 `useAssistantFaceDriver({ mainChat, subtasks, open })`。
  - **生产路径**：`App.tsx:794`–`:801` 在内置运行时、有主对话时挂这一个驱动（去掉了 `import.meta.env.DEV`）；卡片 `SidebarAssistant.tsx:164` 只剩舞台一种（头像槽 `:252`、选中描边 `:257`、两档徽标 `:266`–`:279`、名字行 `:290`）；卡片块 `Sidebar.tsx:456` 固定 `pb-1.5 pt-2`。生产构建的主包里有 `assistant-face`、`assistant-selected-ring`、`animateTransform`，没有 `face-trial-pill`、`临时 · 幅度`、`galley.tmp.faceTrial`、`data-amplitude`、`h-[58px]`（`gui/dist/assets/index-*.js` grep）。
  - **守生产路径的测试**：占比（`assistant-face-director.test.ts:370`、`:381`）、长活安静（`:404` 起）、事件 → 状态（`assistant-face.test.ts`）原本就测生产代码，没动。从 `face-trial.test.tsx` 挪进 `Sidebar.main-chat.test.tsx` 改测生产卡片：舞台居中 72、窄侧栏 48、名字与第二行在脸下面、人物不裁只裁浅底、没有 `data-amplitude`、选中是品牌色描边加满墨不铺底、两档徽标各在一种宽度显示、卡片块 8 / 6px、在跑时没有转圈而减少动态下转圈回来（含叫醒的一轮）、外置运行时没有卡片也没有脸。顶栏 28px 静止与没有徽标挪进 `AssistantAvatar.test.tsx`；`AssistantFace.test.tsx` 的「眼睛在脸里、舌头不碰头」改成 1× 加安静后的姿势，「2× 尺寸加倍」删掉；`assistant-face-motion.test.ts` 的缩放测试改用 `MOTION.quiet.k`。原来钉在 40px 行式卡片上的断言（`h-[58px]`、`size-10`、`bg-selected`、`pb-2.5 pt-3`、在跑时 `data-kind="running"` 的转圈）都改成舞台的。
  - **文档**：`foundations.md` §2.7 原来的「唯一豁免」改称「豁免一」，加「豁免二：助理的脸」（只此一张、状态表以代码为准、≥95% / ≤5% 与测试出处、长活安静、数值在 `MOTION`、为什么用 SMIL、减少动态与暂停、以后加动作的门、历史一句）。`layout-and-chrome.md` §4.2：示意图换成舞台；「助手卡片」开头补舞台的理由与没选的；「构造」整条重写（代码出处、尺寸、实测位置、选中、悬停、按下、窄侧栏、跳出圆框的空间、历史一句「2026-10-14 至 10-20 是 IM 行式卡片（裁决 65）」）；「头像」补「会动的脸」链到 §2.7；「头像标记」写在跑不挂转圈、徽标尺寸；「在跑时说什么」「第二行」里的「头像转圈」改实；「侧栏网格」去掉卡片的头像与时间；区名一条去掉「选中卡片的阴影」。§4.1 身份行写明 28px 头像一律静止。`ipc-protocol.md` §4.4 加「现状」：runner 不发、各处定义在哪、GUI 从哪拿正在调的工具、耦合点与退路。另外顺手改了 `conversation.md` 里一处「头像照旧转圈」（三份文档以外，一句）。
  - **验证**：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check 625ea380 HEAD` 通过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 的 `pnpm --dir gui test` 各 178 个文件 1945 条全过（票 66 时 179 / 1958，少的是删掉的 `face-trial.test.tsx`）；`pnpm --dir gui build` 通过。
  - **生产构建自查**（scratchpad，文件名带 `t67-`，不进仓库）：harness 用 `vite build --mode production` 打包后静态服务，合成数据（不读 `workbench.db`），无头 Chrome 2x：舞台浅色、选中加顶栏、深色、在跑（脸在演，SMIL 元素在）、在跑加减少动态（转圈回来、两个徽标）、170px 窄侧栏（头像 48）、外置运行时；页面上都没有 pill。外置运行时与 `625ea380` 的生产构建同一 harness 逐像素比，浅、深两组差值为零。实测（侧栏 296px）：卡片 52–180.8、头像 58–130、名字行 136、第二行 158、区名行 186.8、新对话按钮 205.8，助理区 142.8px，与票 65、66 一致。
  - **看到没改**：一、票里写「顶栏 28px 头像在跑时照旧有它的徽标」，代码里身份行从来不挂徽标（在跑由下面那行字说），照代码没加，测试守着「没有徽标」。二、`displayPose` 原来在幅度 1 时直接改传进来的姿势（`scalePose(pose, 1)` 返回原对象，随后的收住会写回导演的姿势），现在先复制；画出来的值相同，只是导演手里的姿势不再被悄悄收住。三、舞台卡片高度不固定：还没有任何消息时没有第二行，卡片 110px，第二行出现时列表下移 18.8px（票 65 起就是这样，新主对话问候落地前才会遇到）。四、`ipc-protocol.md` §4.5 `tool_call_end`、§4.6 `tool_call_progress` 同样只定义不发，票只要 §4.4，没动。五、WKWebView 没法在这里验，SMIL 与人物跳出圆框照旧要真机看（同票 65、66）。
