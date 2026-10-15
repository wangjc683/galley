# 叫醒措辞（票 29、30）

`run.py --suite wake` 用这里的措辞拼叫醒消息。每个 `## <名字>` 是一版，`--variant <名字>` 选它；每版下面每个 `### <键>` 一段 `text` 代码块，`{…}` 是填空。

拼法（同票 29「措辞草稿」）：开头一次；各件依次排，件与件之间空一行；不止一件时末尾加 `footer`。
Done 是 `done` 后接一个空格再接 `done_send_back`；打回已满两次（`send_backs ≥ 2`）时，`done_send_back` 换成 `done_capped`。
Asking 的 `{options}` 有候选时是 ` Options: "a", "b"`（前面一个空格），没有候选时为空。

## draft

票 29「措辞草稿」原文，逐字。

### header

```text
[Galley — not a message from the user] A subtask you started has an update. Act on it, then reply to the user. Do not mention this note.
```

### done

```text
Subtask `{id}` "{title}" (round {round}) finished. Its final answer:
<<<
{answer}
>>>
Check it against what you asked for in its instructions (`session show {id} --tail=40` shows them and its steps). If it holds, tell the user the result in a sentence or two and name the evidence (a confirmation number, a file path, a link).
```

### done_send_back

```text
If something is missing or wrong, send it back with `session send {id} "<what is missing>" --supervisor=galley-assistant --reason="send back"` and end your reply with exactly <no-reply/> and nothing else.
```

### done_capped

```text
It has been sent back {send_backs} times already: do not send it back again. Tell the user what it found and what is still missing.
```

### asking

```text
Subtask `{id}` "{title}" is asking: "{question}"{options}.
If the user already told you the answer, or it plainly follows from what they asked for, answer with `session send {id} "<answer>" --supervisor=galley-assistant --reason="answer"` and end your reply with exactly <no-reply/>. If it involves money, sending something to someone, anything that cannot be undone, or something only the user has (a code sent to their phone, a password), ask the user in a sentence, and pass their answer on the same way when they reply.
```

### step_limit

```text
Subtask `{id}` "{title}" (round {round}) paused at the engine's step limit, mid-work. If it is getting somewhere, send it "continue" the same way and end your reply with exactly <no-reply/>; this counts as a round. Otherwise tell the user how far it got.
```

### error

```text
Subtask `{id}` "{title}" stopped on an error: {detail}. Tell the user in a sentence what failed and what you suggest. Do not start it again unless they ask.
```

### not_started

```text
The subtask "{title}" could not be started: {why}. Tell the user in a sentence, and offer to try again.
```

### footer

```text
Reply once, covering all of them.
```

## v2

本票的改字建议：只改 Step limit 一件，其余与 `draft` 逐字相同。

- 补上「最后一段看得见的文字」：票 29 第 3 条要它带说明，草稿没有留填空；`draft` 的两遍里模型都先去翻引擎的 `model_responses` 日志找进度（各多 1～2 次调用），再 `session show`。
- 「the same way」换成写全的命令：这一件单独来时，前文没有可以照着的命令。

### header

```text
[Galley — not a message from the user] A subtask you started has an update. Act on it, then reply to the user. Do not mention this note.
```

### done

```text
Subtask `{id}` "{title}" (round {round}) finished. Its final answer:
<<<
{answer}
>>>
Check it against what you asked for in its instructions (`session show {id} --tail=40` shows them and its steps). If it holds, tell the user the result in a sentence or two and name the evidence (a confirmation number, a file path, a link).
```

### done_send_back

```text
If something is missing or wrong, send it back with `session send {id} "<what is missing>" --supervisor=galley-assistant --reason="send back"` and end your reply with exactly <no-reply/> and nothing else.
```

### done_capped

```text
It has been sent back {send_backs} times already: do not send it back again. Tell the user what it found and what is still missing.
```

### asking

```text
Subtask `{id}` "{title}" is asking: "{question}"{options}.
If the user already told you the answer, or it plainly follows from what they asked for, answer with `session send {id} "<answer>" --supervisor=galley-assistant --reason="answer"` and end your reply with exactly <no-reply/>. If it involves money, sending something to someone, anything that cannot be undone, or something only the user has (a code sent to their phone, a password), ask the user in a sentence, and pass their answer on the same way when they reply.
```

### step_limit

```text
Subtask `{id}` "{title}" (round {round}) paused at the engine's step limit, mid-work. Its last message:
<<<
{last_text}
>>>
If it is getting somewhere, send it "continue" with `session send {id} "continue" --supervisor=galley-assistant --reason="continue"` and end your reply with exactly <no-reply/>; this counts as a round. Otherwise tell the user how far it got.
```

### error

```text
Subtask `{id}` "{title}" stopped on an error: {detail}. Tell the user in a sentence what failed and what you suggest. Do not start it again unless they ask.
```

### not_started

```text
The subtask "{title}" could not be started: {why}. Tell the user in a sentence, and offer to try again.
```

### footer

```text
Reply once, covering all of them.
```
