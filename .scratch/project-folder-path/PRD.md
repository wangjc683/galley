# 项目文件夹：让模型知道它就是用户的文件夹

日期：2026-11-23
来源：社区 issue #34（Windows，v0.7.11，内置内核）。JC 裁决（2026-11-23）：按方案甲做，注入里加「链接不是副本」那一句；
回帖等修复发版后再回。
状态（2026-11-23）：票 01 随 v0.7.12 发出；issue #34 已回帖（issuecomment-7090533295），issue 保持 open。票 01 停在
`needs-dogfood`，等 Windows 上走过 [Windows 清单](../../docs/windows-build-checklist.md)「Project folder」三项或报告人回报；
过了就关票、删本目录（devlog 已覆盖全部裁决）。

## 问题

用户给项目选了文件夹，在对话里说「工作目录下有个某某文件，读取并……」。模型先查 temp，再查用户目录，再全盘搜，最后才在
「项目私域目录」里找到，整轮 104 步；回答里报的交付路径是状态目录下的 `temp\projects\<名字>-<哈希>\…`，用户读成
「产物没放进我的文件夹」。追问后模型又把那个目录说成「纯冗余副本」。

## 根因

1. 产物其实在用户的文件夹里。`temp/projects/<名字>-<哈希>` 是上游 `frontends/workspace_cmd.py` 的 `prepare` 建的目录链接
   （Windows 是 `mklink /J` 的目录联接，其他平台是符号链接），指向用户选的文件夹。两个路径是同一份文件。
2. 模型从没被告知真实路径。每轮注入只有 `plugins/project_mode.py` 的 `_build_injection` 那一段：
   「项目私域目录：<链接路径>（todo、草稿、产物一律放这里……）」。runner 拿到了真实路径，存在 agent 的
   `_ga_project_mode_workspace_path` 上（`runner/ga_session.py` 的 `set_project_mode`），但没有任何代码读它。
3. 系统提示词写的是 `cwd = <状态目录>/temp (./)`，工具基准目录也是 `./temp`。用户说「工作目录」，模型按 temp 去找。
4. 不把项目文件夹绑成进程工作目录是有意的（[2026-06-18](../../docs/devlog/2026-06-18-project-workspace-and-ga-upstream-12655687.md)，
   起因见 [2026-05-14](../../docs/devlog/2026-05-14-project-rootpath-rollback-ga-memory-coupling.md)：绑了之后 `../memory` 全部失效）。
5. 模型把链接当成副本。用户若让它「清掉冗余」，某些删除方式会穿过链接删真实文件。

## 裁决

- **做（票 01）**：内置内核加一个小补丁，注入段落里出现的路径换成真实路径，并说明「用户说的工作目录 / 项目文件夹就是它」
  和「链接不是副本，不要删」。
- **不做**：把项目会话的工具基准目录（`handler.cwd`）指到项目文件夹。那要改系统提示词里的 `cwd` 一句并审计所有用
  `../memory`、`./` 的种子 SOP，就是 deferred 里「Session Workspace」那一套；本 issue 记作它的一条旁证。
- **外置 GA 零变化**：attach 模式不打补丁。少数能启用项目文件夹的外置环境仍是旧说法，这是显式代价。

## 已知边界（修完仍在）

- 模型写相对路径（`./xxx`）或不带目录跑命令时，仍落在 temp 根。
- 种子记忆 `project_mode_sop.md` 仍写着 `./projects/<项目名>/`，模型偶尔可能照它报链接路径；验收时用 issue 里的原话跑一轮看。

## 票

| 票 | 内容 |
|---|---|
| [01](./issues/01-injection-uses-real-folder-path.md) | 项目模式注入改用真实文件夹路径 |
