import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToolCallout } from "./ToolCallout";
import type { ConversationToolEvent } from "@/types/conversation";
import { zhCopy } from "@/i18n/locales/zh";

// useCopy falls back to the zh copy without a CopyProvider.

function pill(name: string, args: Record<string, unknown>): string {
  const tool: ConversationToolEvent = {
    id: "t",
    name,
    status: "success-historical",
    args,
  };
  return renderToStaticMarkup(<ToolCallout tool={tool} />);
}

describe("a Bash or PowerShell call draws as the code_run GA ran it as", () => {
  const command = "# list it\nls -la ~/Downloads";
  const asCodeRun = pill("code_run", { script: command });

  it("draws code_run's pill: icon, label, the command's first line", () => {
    // The tool's icon, then the disclosure caret.
    expect(asCodeRun.match(/<svg/g)).toHaveLength(2);
    expect(asCodeRun).toContain(zhCopy.tools.code_run);
    expect(asCodeRun).toContain("· ls -la ~/Downloads");
  });

  it("draws the same pill for Bash and PowerShell, the command in `command`", () => {
    expect(pill("Bash", { command })).toBe(asCodeRun);
    expect(pill("PowerShell", { command })).toBe(asCodeRun);
  });

  it("reads the command from `cmd` too, as GA does", () => {
    expect(pill("Bash", { cmd: command })).toBe(asCodeRun);
  });

  it("leaves a name it does not know a name-only pill", () => {
    const unknown = pill("bash", { command });
    expect(unknown.match(/<svg/g)).toHaveLength(1);
    expect(unknown).not.toContain(zhCopy.tools.code_run);
    expect(unknown).toContain(">bash</span>");
  });
});
