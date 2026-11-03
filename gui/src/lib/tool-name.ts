/**
 * Tool names the engine runs as another tool. Upstream GA (`5ec4b12`)
 * runs a model's `Bash` / `PowerShell` call — the names Claude Code's
 * tools use — as `code_run` (managed-ga/code/agent_loop.py:19), but GA
 * records the call under the name the model used, with the arguments as
 * the model wrote them (the command in `command`, not `script`), and the
 * runner reports it as recorded. The page draws such a call as the tool
 * that ran.
 */
const TOOL_ALIASES: ReadonlyMap<string, string> = new Map([
  ["Bash", "code_run"],
  ["PowerShell", "code_run"],
]);

/**
 * The tool a call ran as: `code_run` for `Bash` / `PowerShell`, any
 * other name unchanged. Every lookup or branch on a tool's name (its
 * icon and label, its argument preview, the run's tool counts, the
 * assistant's face) goes through this; what the page shows as the wire
 * name stays the name the model used.
 */
export function canonicalToolName(name: string): string {
  return TOOL_ALIASES.get(name) ?? name;
}
