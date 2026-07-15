# Project Mode SOP

## 定义

Project Mode = 跨会话保持项目认知的工作模式
载体：`project_memory.md` + 项目私域目录。两层注入：每轮自动注入的只有 L1（规则+记忆文件指针），L2（`project_memory.md` 全文）不注入——任务涉及项目上下文时自己用 file 工具去读，无关则不读

## 进入

激活态保存在当前 Agent 实例；各会话互不干扰，关闭 GA 自动失效。（下文路径以 cwd (./temp) 为基准，禁重复写 `temp/xxx` 前缀以免temp/temp/...）

- 用户只说「进入项目模式」未指明项目：列出 `./projects/` 下各项目（名字 + memory 行数 + 最后修改时间），ask_user 让用户选定后再继续
- 用户明确说「进入/切换到 <项目名> 项目」：视为已确认，直接执行：

1. 建目录 `./projects/<项目名>/`，无则创建 `project_memory.md`（空文件即可）
2. 用 `code_run` 的 `inline_eval=true` 绑定当前 Agent（`handler` 已注入，无需 import）：
   `handler.enter_project_mode('<项目名>')`
3. 回读 `project_memory.md` 全文，向用户复述项目现状

## 期间纪律

- 项目文件（todo、草稿、产物）一律放 `./projects/<项目名>/`，禁止丢 temp 根目录
- 入库判据（唯一标准）：每得到一条信息，自问「记忆归零、重新接手本项目的我，缺了这条会不会重复付出认知代价——再踩一次坑、再摸索一次、再问一次用户？」会则立即追加进 `project_memory.md`，不会则不记
- 一条一句，写成未来的自己能直接复用的形式；已有条目增量更新，不整篇重写

## 离开

明确要求离开时，用 `code_run`（`inline_eval=true`）执行 `handler.enter_project_mode(None)`。
切换项目直接换项目名
