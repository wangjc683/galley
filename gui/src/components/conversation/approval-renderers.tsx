import { Brain, FloppyDiskBack } from "@phosphor-icons/react";

import { PatchView } from "@/components/conversation/diff/PatchView";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ConversationToolEvent } from "@/types/conversation";

/**
 * Tool-specific Approval Card renderers. Dispatched by tool name.
 * DESIGN.md §4.6 "工具特定渲染".
 *
 * Each renderer takes a ConversationToolEvent and renders the
 * pre-decision body (between the action sentence/reason hint and the
 * four decision buttons). Falls back to GenericArgs when no specific
 * renderer matches.
 *
 * Why one file: each renderer is small (≤30 lines) and they share
 * trivial helpers; splitting per file would scatter the dispatch.
 */
export function ApprovalRenderer({ tool }: { tool: ConversationToolEvent }) {
  switch (tool.name) {
    case "file_patch":
      return <FilePatchRenderer tool={tool} />;
    case "file_write":
      return <FileWriteRenderer tool={tool} />;
    case "code_run":
      return <CodeRunRenderer tool={tool} />;
    case "web_execute_js":
      return <WebExecuteJsRenderer tool={tool} />;
    case "start_long_term_update":
      return <StartLongTermUpdateRenderer tool={tool} />;
    default:
      return <GenericArgsRenderer tool={tool} />;
  }
}

// ---------------- file_patch ----------------

function FilePatchRenderer({ tool }: { tool: ConversationToolEvent }) {
  const path = stringArg(tool, "path");
  const oldContent = stringArg(tool, "old_content");
  const newContent = stringArg(tool, "new_content");

  if (!path) {
    // Defensive: file_patch should always have all three. If not,
    // fall back to the generic args view rather than guessing.
    return <GenericArgsRenderer tool={tool} />;
  }

  return (
    <div className="mb-3 max-h-[480px] overflow-auto">
      <PatchView path={path} oldContent={oldContent} newContent={newContent} />
    </div>
  );
}

// ---------------- file_write ----------------

const FILE_WRITE_MODE_LABEL: Record<string, string> = {
  create: "create",
  overwrite: "overwrite",
};

function FileWriteRenderer({ tool }: { tool: ConversationToolEvent }) {
  const path = stringArg(tool, "path");
  const mode = stringArg(tool, "mode") || "create";
  const content = optionalStringArg(tool, "content");
  const existingContent =
    optionalStringArg(tool, "existing_content") ??
    optionalStringArg(tool, "existingContent");

  if (!path || content === null || existingContent === null) {
    return <GenericArgsRenderer tool={tool} />;
  }

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
        <FloppyDiskBack
          size={14}
          weight="thin"
          className="shrink-0 text-ink-soft"
        />
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-[0.02em]",
            mode === "overwrite"
              ? "bg-warning/[var(--opacity-soft)] text-warning"
              : "bg-info/[var(--opacity-soft)] text-info",
          )}
        >
          {FILE_WRITE_MODE_LABEL[mode] ?? mode}
        </span>
      </div>
      <div className="max-h-[480px] overflow-auto">
        <PatchView
          path={path}
          oldContent={existingContent}
          newContent={content}
        />
      </div>
    </div>
  );
}

// ---------------- code_run ----------------

function CodeRunRenderer({ tool }: { tool: ConversationToolEvent }) {
  const copy = useCopy();
  const language =
    stringArg(tool, "type") ||
    stringArg(tool, "language") ||
    stringArg(tool, "lang") ||
    "shell";
  const code =
    stringArg(tool, "code") ||
    stringArg(tool, "command") ||
    stringArg(tool, "cmd") ||
    "";
  const cwd = stringArg(tool, "resolved_cwd") || stringArg(tool, "cwd");
  const timeout = numberArg(tool, "timeoutSeconds");

  return (
    <div className="mb-3 overflow-hidden rounded-callout border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-[11px]">
        <span className="font-mono uppercase tracking-[0.08em] text-ink-muted">
          {language}
        </span>
        {cwd && (
          <span className="min-w-0 select-text truncate font-mono text-ink-soft">
            {cwd}
          </span>
        )}
        {timeout !== null && (
          <span className="shrink-0 rounded-full bg-info/[var(--opacity-soft)] px-2 py-0.5 text-[10px] font-medium text-info">
            {timeout}s
          </span>
        )}
      </div>
      <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-ink">
        {code || copy.conversation.codeNoCommand}
      </pre>
    </div>
  );
}

// ---------------- web_execute_js ----------------

function WebExecuteJsRenderer({ tool }: { tool: ConversationToolEvent }) {
  const copy = useCopy();
  const script = stringArg(tool, "script") || stringArg(tool, "code") || "";
  const tabId =
    stringArg(tool, "switch_tab_id") ||
    stringArg(tool, "switchTabId") ||
    stringArg(tool, "tabId") ||
    stringArg(tool, "tab_id");
  const noMonitor =
    booleanArg(tool, "no_monitor") ?? booleanArg(tool, "noMonitor");

  return (
    <div className="mb-3 overflow-hidden rounded-callout border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-[11px]">
        <span className="font-mono uppercase tracking-[0.08em] text-ink-muted">
          javascript
        </span>
        {tabId && (
          <span className="min-w-0 select-text truncate font-mono text-ink-soft">
            tab {tabId}
          </span>
        )}
        {noMonitor === true && (
          <span className="shrink-0 rounded-full bg-info/[var(--opacity-soft)] px-2 py-0.5 text-[10px] font-medium text-info">
            no_monitor
          </span>
        )}
      </div>
      <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-ink">
        {script || copy.conversation.emptyContent}
      </pre>
    </div>
  );
}

// ---------------- start_long_term_update ----------------

function StartLongTermUpdateRenderer({
  tool,
}: {
  tool: ConversationToolEvent;
}) {
  const copy = useCopy();
  const key =
    stringArg(tool, "key") ||
    stringArg(tool, "memory_key") ||
    stringArg(tool, "name") ||
    "—";
  const content =
    stringArg(tool, "content") ||
    stringArg(tool, "value") ||
    stringArg(tool, "data") ||
    "";

  return (
    <div className="mb-3 rounded-callout border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
        <Brain size={14} weight="thin" className="text-ink-soft" />
        <span className="text-ink-soft">memory key</span>
        <span className="ml-1 select-text font-mono text-ink">{key}</span>
      </div>
      <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-ink-soft">
        {content || copy.conversation.emptyContent}
      </pre>
    </div>
  );
}

// ---------------- fallback ----------------

function GenericArgsRenderer({ tool }: { tool: ConversationToolEvent }) {
  const args = tool.args ?? {};
  if (Object.keys(args).length === 0) return null;
  return (
    <pre className="mb-3 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-callout border border-line bg-app px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-ink-soft">
      {Object.entries(args).map(([k, v]) => (
        <div key={k}>
          <span className="text-ink-muted">{k}: </span>
          <span>{JSON.stringify(v)}</span>
        </div>
      ))}
    </pre>
  );
}

// ---------------- helpers ----------------

function stringArg(tool: ConversationToolEvent, key: string): string {
  return optionalStringArg(tool, key) ?? "";
}

function optionalStringArg(
  tool: ConversationToolEvent,
  key: string,
): string | null {
  const v = tool.args?.[key];
  return typeof v === "string" ? v : null;
}

function numberArg(tool: ConversationToolEvent, key: string): number | null {
  const v = tool.args?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function booleanArg(tool: ConversationToolEvent, key: string): boolean | null {
  const v = tool.args?.[key];
  return typeof v === "boolean" ? v : null;
}
