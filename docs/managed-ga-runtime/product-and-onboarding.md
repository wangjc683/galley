# Managed Runtime: Product Model And First-Run Onboarding

> Part of the [managed GA runtime reference](./README.md).

## Product Model

Ordinary users should experience this as Galley, not as "installing
GenericAgent." The onboarding path is:

```text
Configure Galley's model -> start using Galley
```

The primary path should ask for only one thing: model access. Users should not
choose a runtime, download an engine, edit config files, install Python, or
understand GenericAgent terminology before they can talk to Galley.

GenericAgent is the internal agent kernel for this mode. Users should not need
to know about GA checkout paths, `mykey.py`, Python, virtual environments,
dependencies, or GA memory layout.

Attach mode is an advanced compatibility path for users who already have their
own GenericAgent environment:

```text
Already have GenericAgent? Connect your existing environment.
```

This entry should be visually secondary. It exists to preserve power-user
control, not to split the first-run product in half.

## First-Run UX Contract

First run should feel like setting up a model, not setting up an agent runtime.

Required first-run fields:

```text
Provider / protocol preset
API key
Base URL
Model
```

Default first-run shape:

```text
One compact setup screen
Primary action: Test and start using Galley
Secondary text link: Already have GenericAgent?
Success destination: first Galley conversation, composer focused
```

Optional first-run behavior:

```text
Display name is auto-filled from model and not shown as a required first-run field
```

Everything else belongs behind advanced disclosure in Settings, not onboarding:
timeouts, retries, proxy, thinking controls, max tokens, generated GA config,
state paths, patch versions, and diagnostic runtime paths.

Good first-run feedback should tell the user what to do next:

```text
Key saved on this Mac. Testing model connection...
Connection works. Start using Galley.
```

Failed first-run checks should keep the user in the same flow, preserve their
inputs, name the failing field, and suggest the next action:

```text
The API key was rejected. Check the key, then try again.
The model endpoint did not respond. Check the base URL or choose another preset.
```

Bad first-run feedback exposes implementation:

```text
mykey.py generated
GenericAgent dependency check passed
NativeOAISession initialized
```

### First-Run Copy Direction

The setup screen should sound like Galley is helping the user connect a model,
not asking them to configure infrastructure.

Recommended Chinese copy:

```text
Title: 为 Galley 配置模型
Body: 填入你的模型 API Key 和 Base URL。
Provider label: 模型服务
Key label: 模型密钥
Base URL label: Base URL
Model label: 模型
Model helper: 自动获取模型列表，或手动填写模型名
Primary button: 测试并开始使用 Galley
Secondary link: 我已有 GenericAgent
Success: 配置完成，可以开始对话了。
```

Avoid copy that makes the user feel they are installing a developer tool:

```text
配置 GenericAgent
生成 mykey.py
选择 NativeOAISession
设置 runtime path
```

Interaction rules:

- Use one screen.
- First managed-runtime onboarding uses a Provider preset dropdown. It may
  expose official-brand shortcuts such as OpenAI, Anthropic, DeepSeek, Kimi,
  MiniMax, OpenRouter, SiliconFlow, Xiaomi MiMo, and GLM, plus protocol-family
  entries when useful.
- A fresh setup must not select a Provider implicitly. Show an explicit empty
  state such as "选择提供商" first, then fill the dependent Provider fields
  from the selected preset.
- Keep onboarding copy plain and low-friction. Settings can use the more precise
  terms `Provider` and `Model`, but first run should not make the user learn the
  Provider / Model data model before starting.
- Preserve all typed values on failure.
- The primary button stays disabled until Provider, API key, Base URL, and model
  are all filled.
- "自动获取模型列表" is an explicit helper action that fills the model field; it
  is not hidden behind the primary button.
- Test the connection before leaving onboarding. The UI may auto-test after all
  required fields are present, but save / continue should still require a
  verified connection.
- Say "model key" or "模型密钥" in first-run copy. Avoid the acronym "BYOK" in
  product UI.
- Never show generated config paths in first-run UI.
- Do not show advanced options in onboarding.
- Keep attach-mode entry visually secondary and label it for users who already
  know they have GenericAgent.
