import { describe, expect, it } from "vitest";

import {
  classifyTool,
  DOZE_AFTER_MS,
  type FaceActivityInput,
  faceActivity,
  liveToolCall,
  liveToolKind,
  NIGHT_DOZE_AFTER_MS,
  shouldDoze,
  wakeKind,
} from "@/lib/assistant-face";
import type { Turn } from "@/types/conversation";

/** GA's verbose dispatch line (managed-ga/code/agent_loop.py:78). */
const dispatch = (name: string, args: Record<string, unknown>) =>
  `🛠️ Tool: \`${name}\`  📥 args:\n\`\`\`\`text\n${JSON.stringify(args, null, 2)}\n\`\`\`\`\n`;

describe("which tool runs: the dispatch line in the round's stream", () => {
  it("reads the last dispatch line, name and arguments", () => {
    const stream =
      "我查一下。\n" +
      dispatch("web_scan", { tabs_only: true }) +
      "\n**LLM Running (Turn 2) ...**\n\n" +
      dispatch("file_read", { path: "notes.md" });
    expect(liveToolCall(stream)).toEqual({
      name: "file_read",
      args: JSON.stringify({ path: "notes.md" }, null, 2),
    });
  });

  it("reads a dispatch whose arguments are still streaming", () => {
    const partial =
      '🛠️ Tool: `code_run`  📥 args:\n````text\n{\n  "script": "ls';
    expect(liveToolCall(partial)?.name).toBe("code_run");
  });

  it("reads the compact form, and none before any dispatch", () => {
    expect(liveToolCall("🛠️ web_execute_js(script=…)\n")?.name).toBe(
      "web_execute_js",
    );
    expect(liveToolCall("我先想想。")).toBeNull();
    expect(liveToolCall("")).toBeNull();
    expect(liveToolKind("我先想想。")).toBeNull();
  });
});

describe("the face for a tool (ticket 65's table)", () => {
  const galley = (script: string) => JSON.stringify({ script }, null, 2);

  it("looks at a page for the browser tools", () => {
    expect(classifyTool("web_scan", "{}")).toBe("browse");
    expect(classifyTool("web_execute_js", "{}")).toBe("browse");
  });

  it("reads for file_read", () => {
    expect(classifyTool("file_read", "{}")).toBe("read");
  });

  it("notes for a file write, a patch, the memory", () => {
    for (const name of ["file_write", "file_patch", "start_long_term_update"]) {
      expect(classifyTool(name, "{}"), name).toBe("note");
    }
  });

  it("notes for a Galley to-do or reminder written in code_run, both ways it writes them", () => {
    const writes = [
      `GALLEY="$(sed -n '1p' "$XDG/galley/cli-path")"; "$GALLEY" todo add "交报销单" --due=2026-10-23`,
      `"$GALLEY" todo update todo_1 --remind-at=2026-10-20T09:00`,
      `"$GALLEY" todo done todo_1`,
      `"$GALLEY" schedule create "提醒喝水" --at="$AT" --target=assistant`,
      `"$GALLEY" schedule delete sched_1`,
      `cli=(Path(os.environ["XDG"])/'galley/cli-path').read_text()\nsubprocess.run([cli,'todo','add','理发','--due=2026-10-18'])`,
      `cli = open(os.path.expanduser("~/.config/galley/cli-path")).read().strip()\nsubprocess.run([cli, "schedule", "create", "提醒"])`,
    ];
    for (const script of writes) {
      expect(classifyTool("code_run", galley(script)), script).toBe("note");
    }
  });

  it("works by hand for any other code_run — Galley reads included", () => {
    const others = [
      `"$GALLEY" todo list`,
      `"$GALLEY" schedule list`,
      `"$GALLEY" schedule run sched_1`,
      `python3 - <<'PY'\nprint(1)\nPY`,
      // A to-do word without the Galley CLI is not a Galley write.
      `echo "todo add milk" >> list.txt`,
    ];
    for (const script of others) {
      expect(classifyTool("code_run", galley(script)), script).toBe("work");
    }
  });

  it("thinks for anything else", () => {
    for (const name of [
      "update_working_checkpoint",
      "ask_user",
      "no_tool",
      "something_new",
    ]) {
      expect(classifyTool(name, "{}"), name).toBe("think");
    }
  });

  it("classifies the live call from the stream", () => {
    expect(liveToolKind(dispatch("web_scan", {}))).toBe("browse");
    expect(
      liveToolKind(dispatch("code_run", { script: '"$GALLEY" todo add x' })),
    ).toBe("note");
  });
});

describe("the activity: waiting for you > an error > writing > doing > thinking", () => {
  const base: FaceActivityInput = {
    asking: false,
    erroring: false,
    running: false,
    writing: false,
    tool: null,
    subtasksRunning: false,
    dozing: false,
  };
  const at = (patch: Partial<FaceActivityInput>) =>
    faceActivity({ ...base, ...patch });

  it("follows ruling 117's order", () => {
    const busy = { running: true, writing: true, tool: "browse" as const };
    expect(at({ ...busy, asking: true, erroring: true })).toBe("ask");
    expect(at({ ...busy, erroring: true })).toBe("error");
    expect(at(busy)).toBe("talk");
    expect(at({ running: true, tool: "browse" })).toBe("browse");
    expect(at({ running: true, tool: "read" })).toBe("read");
    expect(at({ running: true, tool: "note" })).toBe("note");
    expect(at({ running: true, tool: "work" })).toBe("work");
    expect(at({ running: true, tool: "think" })).toBe("think");
    expect(at({ running: true })).toBe("think");
  });

  it("waits for a subtask when it rests with one out, else rests or dozes", () => {
    expect(at({ subtasksRunning: true })).toBe("awaitSubtask");
    expect(at({ subtasksRunning: true, dozing: true })).toBe("awaitSubtask");
    expect(at({})).toBe("idle");
    expect(at({ dozing: true })).toBe("doze");
    // Busy is never a doze.
    expect(at({ running: true, dozing: true })).toBe("think");
  });
});

describe("what woke it: the report row that opens the round", () => {
  const report = (reason: string): Turn => ({
    role: "user",
    content: "[Galley — not a message from the user] …",
    origin: { via: "system", supervisor: "galley-report", reason },
  });
  const agent: Turn = {
    role: "agent",
    turnIndex: 1,
    tools: [],
  } as unknown as Turn;

  it("is a reminder when the note names scheduled tasks only", () => {
    expect(wakeKind([report("sched_372188dfb88fd465")])).toBe("reminder");
    expect(wakeKind([report("sched_1,sched_2"), agent])).toBe("reminder");
  });

  it("is a subtask's report when the note names a session", () => {
    expect(wakeKind([report("s-mver2cpn-guphc9nm")])).toBe("subtask");
    expect(wakeKind([report("sched_1,s-abc")])).toBe("subtask");
  });

  it("is nothing for a round you started", () => {
    expect(wakeKind([report("sched_1"), { role: "user", content: "hi" }])).toBe(
      null,
    );
    expect(wakeKind([])).toBe(null);
  });
});

describe("丙 dozes after 30 minutes, or late at night after a minute", () => {
  it("by day", () => {
    expect(shouldDoze(DOZE_AFTER_MS - 1, 14)).toBe(false);
    expect(shouldDoze(DOZE_AFTER_MS, 14)).toBe(true);
    expect(shouldDoze(NIGHT_DOZE_AFTER_MS, 22)).toBe(false);
  });

  it("from 23:00 to 07:00", () => {
    for (const hour of [23, 0, 3, 6]) {
      expect(shouldDoze(NIGHT_DOZE_AFTER_MS, hour), String(hour)).toBe(true);
      expect(shouldDoze(NIGHT_DOZE_AFTER_MS - 1, hour)).toBe(false);
    }
    expect(shouldDoze(NIGHT_DOZE_AFTER_MS, 7)).toBe(false);
  });
});
