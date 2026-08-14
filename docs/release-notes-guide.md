# Release Notes Guide

> Writing guide and templates for GitHub Release notes. The release-day
> procedure lives in the [release / update SOP](./release-update-sop.md);
> its draft-review step links here. This document owns how the notes are
> written; the SOP owns when they are audited and against what.

## Writing Rules

- English first, Chinese second. Both sections should be complete; do not use a
  thin machine translation. Keep the two halves in sync — a bullet in one must
  appear in the other.
- Keep the headings stable: `## What's New`, optional `## Under the Hood`,
  `## Installation Guide`, `---`, `## What's New`, optional
  `## Under the Hood`, `## 安装指南`.
- **State the change once.** One bullet, one clause, no restatement. A bullet
  that opens with a result, explains the mechanism, then closes with the same
  result is saying one thing three times — for a reader who understands the
  change, the consequence is self-evident. This is the single most common
  defect in this project's drafts, so it leads the list.

  Worked example, `v0.4.8`:

  > ❌ Fewer repeated answers: a finished reply that ends with its own summary
  > is no longer mistaken for a truncated stream and regenerated, so completed
  > turns stop looping.
  >
  > ✅ Replies that end with a summary are no longer misclassified as truncated
  > and regenerated.

  The old rule here mandated `<User outcome>: <what changed>, so <why it
  matters>`, which assumes the outcome and the change are two pieces of
  information. For this product's readers they usually are not, and the
  template reliably produced the ❌ form above. It was removed on 2026-08-14.
- **Lead with what changed for the user, not with an implementation area.**
  "Replies that end with a summary…", not "Streaming: …"; "新增字号切换", not
  "修复了用户反馈的字号问题". Dropping the outcome-restatement tail does not
  license opening with a subsystem name.
- **Name what the user has seen.** A concrete token the reader has met in the
  product — `!!!Error:` appearing in a reply, a setting's actual label — is
  more precise than a paraphrase of it, and naming it is not "exposing
  implementation". The test is whether the user could have encountered the
  thing. Internals they could not have seen stay out: file names, functions,
  patch numbers, upstream SHAs, internal identifiers.
- **Tone: technical, terse, professional.** Assume a reader who runs agent
  tooling. Drop hedges and filler ("修复了一个 case", "保持不变"), and do not
  describe the pre-release state for its own sake. If a sentence does not tell
  the reader something they can see or act on, cut it or move it to
  `Under the Hood`.
- Use `Under the Hood` only for meaningful engineering maintenance that helps a
  technical reader trust the release but is not itself a user feature. Omit the
  section when there is no such work.
- Scope to what changed this tag, not the whole product. The SOP's draft-review
  step audits `git log <PREVIOUS_TAG>..HEAD --oneline` against the bullets;
  every user-facing commit maps to a bullet or is explicitly decided to omit.
  A release that ships a new feature plus a fix is not a "hotfix" even if it
  started as one — title and bullets must reflect everything shipped.
- For patch releases, 3-5 focused bullets are enough. For larger releases, keep
  the list scannable instead of turning it into a changelog dump.
- **Collapse commits, not changes.** Several commits implementing one change
  (e.g. six typography commits) become one bullet. Two distinct changes that
  merely share a theme stay separate — merging them yields a long bullet that
  is precise about neither, and one short bullet each is both terser per line
  and more exact. (`v0.4.8`: the Channels auto-expand predicate and the
  sidebar's Archived count were briefly merged as "quieter navigation chrome",
  then split back.)
- Keep established product terms such as `Galley`, `GA`, `GenericAgent`,
  `Agent / CLI`, `Browser Control`, `Channels`, and `ChatGPT / Codex`.
- Use `内置 GA` in Chinese and `Bundled GA` in English. Do not expose
  `managed GA` in user-facing release notes.
- Installation links must point directly to GitHub Release assets.
- Always include the macOS quarantine command and Windows SmartScreen note while
  Galley is unsigned.
- Omit general compatibility / non-change statements ("no Agent API / DB / GA
  baseline changes", "reduce heat and resource usage") unless they change what
  a user does next. The release notes describe changes, not reassurances.

## Stable Release Notes Template

Use this compact template for stable and beta releases. Future GitHub Release
notes should follow this structure unless the release owner explicitly approves
a different format. The point is to answer two user questions directly: what
changed, and which installer should I download? For alpha releases, use the
alpha template below.

Replace `<TAG>` with the Git tag (for example `v0.2.5`) and `<VERSION>` with
the package version (for example `0.2.5`).

````markdown
## What's New

- <What changed for the user, in one clause, stated once>.
- <What changed for the user, in one clause, stated once>.
- <What is now more reliable, in one clause, stated once>.

## Under the Hood

- <Engineering maintenance a technical reader needs to trust the release; semicolons over conjunctions>.

## Installation Guide

### macOS

- [Download for Apple Silicon](https://github.com/wangjc683/galley/releases/download/<TAG>/Galley_<VERSION>_macOS_aarch64.dmg)
- [Download for Intel](https://github.com/wangjc683/galley/releases/download/<TAG>/Galley_<VERSION>_macOS_x64.dmg)

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [Download for Windows](https://github.com/wangjc683/galley/releases/download/<TAG>/Galley_<VERSION>_Windows_x64-setup.exe)

If Windows SmartScreen shows a warning, click "More info" -> "Run anyway".

**Full Changelog**: https://github.com/wangjc683/galley/compare/<PREVIOUS_TAG>...<TAG>

---

## What's New

- <用户侧发生了什么变化，一个从句，只说一次>。
- <用户侧发生了什么变化，一个从句，只说一次>。
- <现在什么更可靠，一个从句，只说一次>。

## Under the Hood

- <技术读者用来建立信任的工程维护；用分号，别用连词串成长句>。

## 安装指南

### macOS

- [下载 Apple Silicon 版](https://github.com/wangjc683/galley/releases/download/<TAG>/Galley_<VERSION>_macOS_aarch64.dmg)
- [下载 Intel 版](https://github.com/wangjc683/galley/releases/download/<TAG>/Galley_<VERSION>_macOS_x64.dmg)

如果 macOS 提示无法打开 Galley，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

### Windows

- [下载 Windows 版](https://github.com/wangjc683/galley/releases/download/<TAG>/Galley_<VERSION>_Windows_x64-setup.exe)

如果 Windows SmartScreen 提示风险，点击「更多信息」->「仍要运行」。
````

## Alpha Release Notes Template

Use this compact template for tester / early-adopter alpha builds. Keep updater
checks out of the default test list unless the alpha is explicitly promoted to
an update channel.

````markdown
For testers and early adopters. This alpha build is still evolving quickly and may be unstable, so it is not recommended for general users.

## Please Test

- Complete Onboarding after a fresh install, configure a model, and enter the main screen.
- Start a new conversation and confirm Galley replies normally.
- Connect WeChat in Settings -> IM, then send a message to Galley from WeChat.
- Install the Browser Control extension, test the connection, and run a simple browser task.
- Quit and relaunch Galley, then confirm model settings, conversation history, and WeChat connection state still look correct.

## macOS Install Note

If macOS says Galley cannot be opened, run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

---

适合内测用户和愿意尝鲜的用户体验。alpha 版本仍在快速迭代，可能存在稳定性问题，不建议普通用户安装。

## 请重点测试

- 全新安装后完成 Onboarding，配置模型并进入主界面。
- 新建对话，确认 Galley 能正常回复。
- Settings -> IM 接入微信，扫码后从微信给 Galley 发消息。
- 浏览器控制扩展安装、连接测试和简单浏览器任务。
- 退出并重启 Galley，确认模型配置、历史对话和微信接入状态符合预期。

## macOS 安装提示

如果 macOS 提示无法打开，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```
````
