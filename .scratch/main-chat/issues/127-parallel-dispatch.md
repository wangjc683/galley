# 127 几件互不相干的差事，一件一个标签、同时派出去

Status: needs-dogfood（2026-11-03 快进合入 `57ddbc74`。评测新建 `dispatch-parallel` 套件，61 次模型调用：新用例三件差事两遍都 3 个标签、一件拆三块两遍都 3 个、同一批文件两遍都 1 个、分东西部的问题两遍都自己答；同一标签页第 1 遍自己开浏览器去看购物车（裁决 160 的判据问题，真机留意）；订票加天气两遍都没派（沙盒不跑浏览器、用例没写出发地，没测出结论）；票 115 的 16 条没退步（big-quotes 这遍先问链接，只跑一遍）；21 个标签都有标题，6–14 个字。入口层预算 4049 → 4344。合入后 Core 二进制里有手册 `cli.md:72` 补的那句。真机要看：一次交几件差事是不是同一条回复派出几件；交代碎不碎、通知多不多、插话等多久（裁决 174 第 5 条））

来源：[主对话 PRD](../PRD.md) 裁决 174。只改入口层派活那一段、手册 `cli.md` 一句、对应 Core 断言，和评测；不动 GUI、runner、CLI、Agent API、迁移。只影响内置运行时；外置零变化。接在票 [126](./126-subtask-short-title.md) 后面，由同一个代理在同一个 worktree 里做（标签已带 `title`）。

## 为什么

Core 早就支持一条回复写多个 `<subtask>`，一个标签一件，按顺序起、同时跑（`core/src/subtask.rs:25`，裁决 53）。入口层却只写「回复末尾写一个标签」，从没说过可以派几件。JC 另一台机器上，主对话里只出现一张卡片，侧栏「其他来源」里却冒出别的子任务，推测是模型想并行时绕去用 `galley session new` 开了会话（手册 `docs/managed-ga-runtime/galley-assistant-manual/cli.md:72` 说别这样）。这样开的会话没有卡片，做完也不叫醒主对话。派活判据（裁决 160：你在问的自己答，交办的差事派出去）不变。

## 要做到

### 1. 入口层补并行

在 `core/src/managed_prompt.rs` 派活那一段（`main_chat_entry_layer`，票 126 改过的标签那句后面）加一句。意思如下，措辞照附近的英文口气，可以润色但不改意思：

> When the user hands you several errands that do not depend on each other, or one errand splits into parts that do not, write one tag per part in the same reply: they run at the same time. Keep in one tag the parts that need the same browser tab or the same files, and do not split a question.

- 不加数量上限，不写「at most N」。
- 文档注释（约 `:430-449`）补一句为什么：裁决 174；问题不拆是 160 的理由；同一标签页、同一批文件不拆是 GA 的「键鼠不可共享；浏览器避免同tab」。
- 对应的 Core 断言加上这一句。

### 2. 手册 `cli.md:72`

在「Start new work with the `<subtask>` tag, not `session new`: only a subtask wakes you when it is done.」后面补一句：要同时做几件，就写几个标签。改完核对 `core/src/assistant_manual.rs` 里有没有钉着这段原文的断言，有就跟着改。

### 3. 评测

在 `.scratch/main-chat/entry-layer-eval/` 下沿用 `dispatch-criterion` 套件的沙盒和判定，二选一：加一组用例，或新建 `dispatch-parallel` 套件。哪种更顺按 README 和 `run.py` 现有的写法定，在报告里说明。只跑新提示词（main 加上本票的改动），不跑旧提示词对照。

用例（中文用户消息，标注写进用例文件）：

| id | 用户说 | 应该 |
|---|---|---|
| p-three-errands | 帮我把下载文件夹里的发票按月份归档，把桌面上的截图按日期放进文件夹，再把「文档/合同」里的 PDF 改名成「日期-对方」 | 3 个标签 |
| p-split-one | 把「客户」文件夹下 A、B、C 三个子文件夹各自整理出一份文件清单 | ≥2 个标签 |
| p-same-tab | 在京东把购物车里那三样东西下单 | 1 个标签 |
| p-same-files | 把下载文件夹里的 PDF 先去重，再按内容分类 | 1 个标签 |
| p-question-parts | 新赛季西部和东部各有哪几支队能进季后赛？ | 0 个标签（自己答） |
| p-errand-and-question | 帮我订周五去厦门的高铁票，顺便告诉我厦门这周末天气怎么样 | 1 个标签（订票），天气自己答 |

- 判定只认最终回复里的标签（同票 115 的做法）。
- 每个标签都要有 `title`，清理后不超过 20 个字符，不能和指令第一行一模一样。
- `dispatch-criterion` 原有的 16 条用例，在新提示词下也跑一遍，看有没有退步（该自己答的被派出去、该派的没派）。

**模型与额度**：模型写死 `mm_1792576875658`（API key 接入的那个，不在库里就停下回报）。解释器用 `/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`，带 `PYTHONDONTWRITEBYTECODE=1`。先跑 `--dry-test` 过了再跑真模型；主会话已放行真模型运行，上限 120 次模型调用，到了就停下回报。结果文件和报告里不写服务商名、接口主机，不写本机路径。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
git diff --check main...HEAD
PYTHONDONTWRITEBYTECODE=1 /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 .scratch/main-chat/entry-layer-eval/run.py --suite <套件> --dry-test
```

- 跑真模型的评测，附结果表：每条用例的标签数、标题、判定，以及原 16 条有没有退步，还有实际用了多少次模型调用。
- 中文全角标点：在 scratchpad 写 `cjk-punct-127.py`，扫新增行。只对动过的 `.rs` 跑 rustfmt。

## 别动

- 只在 worktree 里改，绝不碰主工作树；不跑 `tauri dev`，不跑 `galley` 写命令，不写用户的应用数据目录。
- 派活判据（裁决 160 那几句）不改；GUI、runner、Agent API 不动；`.scratch/*/entry-layer-eval/` 下已经生成的历史结果不改。

## 提交与回报

同票 126：点名提交，英文说明，末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`，提交号只抄输出。报告：①改了哪些文件 ②提交号 ③验证与评测结果 ④偏离票面的地方 ⑤看到没改的 ⑥Open risks。
