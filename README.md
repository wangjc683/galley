<p align="center">
  <img src="docs/assets/galley-icon.png" alt="Galley logo" width="96" />
</p>

<h1 align="center">Galley</h1>

<p align="center">
  <strong>Less harness. More model.</strong>
  <br/>
  A lightweight, general-purpose assistant that lives on your computer: a thin harness that leans on the model itself, built to get better with every model release.
</p>

<p align="center">
  <a href="https://github.com/wangjc683/galley/releases"><strong>Download</strong></a>
  ·
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#a-quick-tour">Tour</a>
  ·
  <a href="./docs/README.md">Docs</a>
  ·
  <a href="./README.zh-CN.md">中文</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://github.com/wangjc683/galley/releases"><img src="https://img.shields.io/github/v/release/wangjc683/galley?include_prereleases" alt="Latest Release" /></a>
  <a href="https://github.com/wangjc683/galley/releases"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue" alt="Platform" /></a>
  <a href="https://github.com/wangjc683/galley/stargazers"><img src="https://img.shields.io/github/stars/wangjc683/galley?style=social" alt="Stars" /></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/en/hero-dark.png">
    <img src="docs/screenshots/en/hero.png" alt="Galley main conversation view: an agent working through a multi-step browser run" width="800" />
  </picture>
  <br/>
  <sub>Follows your system appearance — light or dark.</sub>
</p>

---


## What Is Galley

Galley is a personal AI assistant that runs on your own computer and actually gets things done — driving your browser, terminal, and files, even your phone. Its harness is deliberately thin: the engine keeps the tool set minimal and the context dense, so the model's own ability does the work, and every model upgrade lands as a Galley upgrade — no waiting for us to catch up.

When one assistant isn't enough, Galley becomes a team. Multiple sessions advance in parallel, ready to switch, take over, and resume at any time. You watch progress and send instructions in the GUI; a Supervisor Agent orchestrates the same team through the CLI — two roles, one shared state, all of it on your machine.

| For Humans | For Agents | Ready By Default |
|---|---|---|
| Manage sessions, projects, and tool timelines in the GUI | The `galley` CLI is a stable public contract for Supervisor Agents | Bundled engine, CPython 3.11, runtime dependencies, and Browser Control assets |

---

## Highlights

### One agent that gets things done

Powered by the bundled engine — a derivative work of [GenericAgent](https://github.com/lsdefine/GenericAgent), shipped inside the installer, ready on first launch.

| | |
|---|---|
| 🖥️ **System-level execution**<br/>Terminal, filesystem, keyboard and mouse, screen vision, all the way to driving a phone over ADB — from looking things up to actually getting them done. | 🌐 **Your real browser**<br/>Unlock it once by loading the bundled extension into Chrome or Edge, and the agent works in the browser you are already signed into — accounts, memberships, and work consoles are all there. No re-login. |
| 🧬 **Self-evolving skills**<br/>Every new task it solves is crystallized into a reusable skill; the longer you use it, the more capable it gets — and the skill tree lives on your machine. | 💰 **Token efficiency, measured**<br/>The engine keeps context dense instead of long. In the [GenericAgent paper](https://arxiv.org/abs/2604.17091) it completed Lifelong AgentBench at 100% accuracy on 3–6× fewer input tokens than leading agents. Galley sets the default window at 90K tokens, leaving headroom for long tasks. |
| 🔌 **Any model, including local ones**<br/>Built-in presets from Anthropic and OpenAI to DeepSeek, Kimi, and GLM — or sign in with your ChatGPT account instead of an API key. Custom takes any OpenAI- or Anthropic-compatible endpoint, a local server such as Ollama needs no key, and each conversation sets its own reasoning effort. | 📖 **Reading panel**<br/>Files the agent writes open from the step that wrote them, right beside the conversation — Markdown, code, images, CSV as a table. Add files or images from the composer, and point the panel at a Git repository to review changes read-only, unified or split, without leaving Galley. |

### One team you can actually manage

Galley's orchestration layer. You operate in the GUI; a Supervisor Agent goes through the stable `galley` CLI. Both are first-class operators sharing the same sessions and history — not separate worlds.

| | |
|---|---|
| 🧭 **Project workspace + multiple sessions**<br/>Point a folder — a code repo or a document directory — at a Project workspace; multiple sessions advance around the same project in parallel, then converge. | 🎯 **Galley Goal**<br/>Hand a conversation a goal and Galley keeps it going on its own, round after round, until the model declares the goal done, the time ceiling you set runs out, or you stop it. |
| 🔧 **Transparent runs**<br/>Watch the model's reasoning stream in while it works; every step opens to its full arguments and result, and a finished run folds into one line — how many steps, how long. | ⏰ **Scheduled tasks**<br/>Give a prompt a time — daily, weekly, or monthly; at that moment Galley opens a new session, runs it, and the result waits for you in the sidebar. Galley needs to be running, and it can launch at login. |
| 💬 **IM Channels**<br/>Connect WeChat, Feishu, Telegram, or Discord and the same assistant answers from your phone — it does the work itself, and can hand longer jobs to sessions on your desktop. | 💾 **Persistence + search + background mode**<br/>Close the window without quitting: Galley stays in the menu bar / tray and notifies you when a reply or a Goal finishes. Every past conversation is searchable with ⌘K (Ctrl+K on Windows). |

---

## A Quick Tour

| | |
|---|---|
| ![Tool timeline](docs/screenshots/en/tools.png)<br/><sub>Tool timeline — every call's arguments, result, and timing, inline</sub> | ![Reading panel](docs/screenshots/en/reading.png)<br/><sub>Reading panel — review worktree changes beside the conversation</sub> |
| ![Project view](docs/screenshots/en/projects.png)<br/><sub>Project view — sessions advancing around one project</sub> | ![Goal](docs/screenshots/en/goal.png)<br/><sub>Goal — a long-running objective with chapter markers</sub> |
| ![Scheduled tasks](docs/screenshots/en/scheduled.png)<br/><sub>Scheduled tasks — a prompt that runs itself every morning</sub> | ![Search](docs/screenshots/en/search.png)<br/><sub>⌘K — every past conversation, straight to the matching line</sub> |

---

## Quick Start

Decide how you'll connect a model first. Presets for ChatGPT / Codex, OpenAI, Anthropic, DeepSeek, Kimi for Coding, MiniMax, OpenRouter, SiliconFlow, Xiaomi MiMo, and Zhipu GLM are built in, with the endpoint prefilled: ChatGPT / Codex signs in with your ChatGPT account, the others take an API Key. For any other OpenAI- or Anthropic-compatible endpoint, pick Custom and enter its URL; a local server such as Ollama needs no key.

| 1. Download Galley | 2. Configure a model | 3. Start using it |
|---|---|---|
| Download the macOS / Windows installer from [Releases](https://github.com/wangjc683/galley/releases). | On first launch, pick a provider and paste your API Key (or sign in with ChatGPT) — the connection is tested automatically. | Click "Start using Galley" to enter the main conversation view (a ChatGPT sign-in takes you straight there). |

| Platform | Installer |
|---|---|
| macOS Apple Silicon | filename contains `macOS_aarch64.dmg` |
| macOS Intel | filename contains `macOS_x64.dmg` |
| Windows x64 | filename contains `Windows_x64-setup.exe` |

<details>
<summary>Install notes</summary>

Galley is not code-signed yet. If macOS blocks the first launch, run:

```bash
xattr -dr com.apple.quarantine /Applications/Galley.app
```

On Windows, when SmartScreen says the publisher is unknown, choose "More info" → "Run anyway".

If you already have a [GenericAgent](https://github.com/lsdefine/GenericAgent) environment, choose the GA folder from **Settings → Runtime → More → Connect external GA**. Once attached, Galley stays strictly read-only and never touches your external GA's code, memory, SOP, or `mykey.py`. Browser Control and Channels run on the bundled engine only, and the providers under **Settings → Models** serve the bundled engine; an external GA keeps using its own `mykey.py`.

</details>

---

## Supervisor / Channels

In the running GUI, open **Settings → Agent**:

| Button | What it does |
|---|---|
| **Copy SOP** | Copies the short [`galley-supervisor-sop.md`](./docs/integrations/galley-supervisor-sop.md), so your Agent can inspect, continue, start, split, and wait for Galley work; advanced details live in the [Supervisor reference](./docs/integrations/galley-supervisor-reference.md) |
| **Open Agent API docs** | Under **Advanced options**: opens the full command reference, JSON schemas, and exit codes |
| **Install galley command** | Under **Advanced options** (macOS): puts `galley` on your PATH for you and your scripts; the SOP doesn't need it |

You don't need to learn the CLI yourself — tell your Supervisor Agent what you want in natural language and let it operate Galley. The copied SOP is a lightweight hot path; detailed commands and advanced orchestration stay in the reference and Agent API. Claude Code users can install the same SOP as a skill: [galley-supervisor](./.claude/skills/galley-supervisor/README.md) (a Codex copy lives under `.agents/skills/`).

Work scales to the right container instead of becoming one giant prompt:

- **Simple requests** — read from or follow a single session;
- **Project / folder work** — bind a workspace with Project Workspace and run sessions in parallel;
- **Long-running goals** — when you ask for one, start a Goal on a session with a time ceiling and let it keep going until it's done.

You can also connect WeChat / Feishu / Telegram / Discord from **Settings → Channels** and reach the same assistant from your phone; it hands longer jobs to desktop sessions.

<details>
<summary>Show CLI examples</summary>

When Galley is running, a Supervisor Agent on the same machine can dispatch tasks through `galley`:

```bash
# What's running right now? (`live.busy` on each row is the truthful signal;
# `live.askPending` means the session is waiting on a question)
galley status
galley sessions list

# Start a new session to follow up on a PR
galley session new --project=proj_work \
  --supervisor=ga-claude-1 --reason="follow up on PR review" \
  "look at the feedback on #1234"

# Complex task: use one Project to hold a group of sessions
galley project create "Release readiness review" \
  --supervisor=ga-claude-1 --reason="parallel release-risk review"

galley session new "Read-only check of app identity, data directory, SQLite migrations, and backup risks. Output risks with evidence." \
  --project=<project-id> --supervisor=ga-claude-1 --reason="check data safety"

galley session new "Read-only check of packaging, release workflow, bundled resources, and version bumps. Output a release blocker checklist." \
  --project=<project-id> --supervisor=ga-claude-1 --reason="check release packaging"

galley project follow <project-id> --tail=80 --until-idle --final-show

# Long-running goal (only when the user asks for one): the session keeps going
# until the model declares it done, the time ceiling hits, or you stop it
galley goal start <session-id> "ship the next patch release" --budget-minutes=60 \
  --supervisor=ga-claude-1 --reason="user asked Galley to keep going until done"

galley goal status <goal-id>
galley goal extend <goal-id> --minutes=30
galley goal stop <goal-id>

# Follow one session, or wait until its run ends
galley session follow <id>
galley session wait <id> --until-idle --timeout=600

# Switch model / archive / restore
galley llm set <id> "another model name"
galley session archive <id> --supervisor=ga-claude-1 --reason="done"
galley session restore <id>
```

Write commands take `--supervisor` and `--reason`; with `--supervisor` set, the work is recorded as `via=supervisor` (otherwise `via=cli`). Sessions and messages a Supervisor creates carry a Supervisor mark in the sidebar and the timeline, so the human can see at a glance what came from an agent.

Full command reference, JSON schemas, and exit codes live in the [Agent API docs](./docs/agent-api/README.md).

</details>

---

## Architecture

The GUI and the CLI are **peer frontends** — not a GUI wrapping a CLI, but two equals each talking directly to the same **Rust Core**: the GUI from inside the app, the CLI over a local socket. Core is the single authority, owning session / Project / Goal state, the Goal loop, scheduled tasks, SQLite writes, and every Python process Galley runs; by default those run on the bundled engine, ready out of the box.

<details>
<summary>Show architecture diagram</summary>

```text
+----------------+                  +----------------+
|   Galley GUI   |---+          +---|   Galley CLI   |
|  Tauri/React   |   |          |   |      Rust      |
+----------------+   |          |   +----------------+
         in-process  v          v
              +------------------------+        localhost only
              |      Galley Core       | <----  unix socket / named pipe
              |          Rust          |        no TCP / no token / no TLS
              |  - session lifecycle   |
              |  - projects + goals    |
              |  - scheduled tasks     |
              |  - SQLite authority    |
              |  - process ownership   |
              +-----------+------------+
                          |
       +------------------+-------------------+
       v                  v                   v
+-------------+   +---------------+   +----------------+
| Runner x N  |   | IM channels   |   | Browser bridge |
| one per     |   | one per       |   | resident,      |
| session     |   | connected app |   | for Chrome/Edge|
+------+------+   +-------+-------+   +--------+-------+
       |                  |                    |
       +------------------+--------------------+
                          v
              +------------------------+
              |   Galley-managed GA    |
              | - GenericAgent engine  |
              | - Galley patch stack   |
              | - Galley runtime prompt|
              | - bundled CPython 3.11 |
              +------------------------+
```

All three kinds of process run Python. When you attach an external GA, session runners use it instead, and IM channels and the browser bridge stay off.

</details>

**Tech stack:** Tauri v2 + React 19 + TypeScript 5.8 + Tailwind v4 / Rust (Galley Core + Galley CLI) / Python (runner, wraps GenericAgent) / SQLite + FTS5 trigram

More docs:
[Architecture](./docs/architecture.md) ·
[Contributing](./CONTRIBUTING.md) ·
[Docs index](./docs/README.md)

---

## Under the Hood

A few design choices that aren't in the feature list but shape Galley's engineering quality:

<details>
<summary>Show the six design choices</summary>

- **Peer frontends, not a GUI wrapping a CLI.** The GUI and CLI each reach the Rust Core on their own, so neither depends on the other. Closing the window leaves Core, its sessions, and the CLI running in the background. Chat apps didn't need a protocol of their own either: inside each IM channel, the assistant drives Galley through the same CLI a Supervisor uses.

- **The Rust Core is the single authority.** The state machines for sessions / Projects / Goals, the Goal loop, scheduled tasks, SQLite writes, and every child process converge in one place. Frontends read projections and send intents; they hold no writable state, which removes multi-end state drift at the root.

- **A local-first security model.** Inter-process traffic runs over a Unix socket (`0600`) or a Windows named pipe, localhost only, no token, no TLS — because the trust boundary is "the same user on the same machine." Not forcing network-style auth onto a local tool is a deliberate subtraction.

- **The Agent API is a versioned public contract.** CLI output carries a `schemaVersion`; within a version, changes are additive only, and a breaking change takes a new version — `2` arrived with Goal v2 in v0.5.0, while every command that didn't change still answers `1`. Write commands record who asked and why (`via` / `supervisor` / `reason`). A Supervisor can program against it with confidence.

- **Discipline at the dual-runtime boundary.** The default is the bundled engine (CPython 3.11 and dependencies included, ready out of the box); when attaching an external GenericAgent, Galley stays strictly read-only — it never touches the external GA's code, memory, SOP, or `mykey.py`, so your existing environment stays clean.

- **A persistence layer built to evolve.** SQLite is the authoritative store; before applying ordered migrations, an upgrade backs up the whole data directory. Past sessions are indexed with FTS5 trigram so even Chinese substrings are searchable, staying resident in the background and instantly searchable when you return.

</details>

---

## Why "Galley"?

A ship's galley is both kitchen and workbench. Everyone comes there for a different reason, but **the table is the same table**.

Galley is that shared table: humans drive work from the GUI, while Supervisor Agents manage the team through the CLI. Both share the same sessions, history, and decision log instead of living in separate tabs.

> *Galley started as a workbench for [GenericAgent](https://github.com/lsdefine/GenericAgent). The first two letters of our name are a quiet bow to where we came from.*

<p align="center">
  <img src="docs/screenshots/en/new.png" alt="A new conversation: the empty workspace with its epigraph" width="640" />
  <br/>
  <sub>Every new conversation opens on an epigraph — this one from the <em>Investigations</em>.</sub>
</p>

## Contributing / Building From Source

```bash
git clone https://github.com/wangjc683/galley
cd galley
pnpm --dir gui install
./scripts/bundle-python.sh mac-arm64   # or mac-x64 / win-x64: stages the bundled Python once
pnpm --dir gui tauri dev               # desktop dev mode
```

Prerequisites, the checks CI runs, runner tests, installer and standalone CLI builds are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Acknowledgments

Galley's engine is a derivative work of [**lsdefine/GenericAgent**](https://github.com/lsdefine/GenericAgent) — a minimal, self-evolving agent framework grown from ~3K lines of seed code. Galley would not exist without that clean foundation.

Paper: [GenericAgent: A Token-Efficient Self-Evolving LLM Agent via Contextual Information Density Maximization (arXiv:2604.17091)](https://arxiv.org/abs/2604.17091)

## License

[MIT](./LICENSE)
