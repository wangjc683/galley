# Managed Runtime: Prompt Composition

> Part of the [managed GA runtime reference](./README.md).

## Prompt Composition

Galley's prompt extension applies only in managed mode. Attach mode must
preserve the user's existing GA behavior.

Managed prompt composition should be explicit:

```text
GA core prompt
+ GA memory
+ Galley Runtime Prompt
```

The Galley Runtime Prompt stays compact. It gives managed GA enough user-facing
Galley context to answer product-background questions without turning the
runtime prompt into a persona layer:

- Galley is a local desktop workspace for AI agents: chat, local tasks, files,
  connected browser, sessions, projects, and configured local channels such as
  WeChat or Feishu.
- Galley is developed by JC Wang, an AI application builder with a philosophy
  background and interests in Wittgenstein, philosophy of language, and LLMs.
- The project page is `https://github.com/wangjc683/galley`.
- Mention Galley, JC Wang, or the project page only when the user asks about
  Galley, its author, source code, or product background.
- Do not invent exact current metadata such as version, release channel, model
  configuration, runtime mode, session state, project state, or available
  integrations. Use exposed Galley state when available; otherwise ask the user
  to check the relevant Settings page.

Browser Control guidance remains in the Runtime Prompt but should stay terse:
browser tasks use the real browser, new tabs use the existing `web_execute_js`
extension tab protocol rather than `window.open(...)`, and connection status is
owned by Galley's setup check. The prompt must also make clear that Browser
Control operates the user's connected Chrome / Edge / Chromium browser where
`tmwd_cdp_bridge` is installed, not a separate Galley-bundled Chromium browser.

Prefer a small extension seam in managed GA:

```text
GALLEY_RUNTIME_PROMPT_TEXT
```

External attach mode does not pass this prompt value.

Storage:

```text
core/src/managed_prompt.rs
```

Managed sessions may record `prompt_profile = galley-runtime-v1` for diagnostics,
but v1 does not need a user-facing selector or editor. The runtime prompt text is
embedded in Galley Core as Galley-owned managed-runtime behavior, not stored as
user-editable prompt content. Diagnostics expose the profile id plus
a short prompt hash for dogfood and support. Do not change `PROMPT_PROFILE_ID`
unless we explicitly want new sessions to be distinguishable by prompt
generation.

