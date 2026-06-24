import type { ImCopy } from "./types";

export function FeishuCommandReference({ imCopy }: { imCopy: ImCopy }) {
  return (
    <TextCommandReference
      title={imCopy.feishuTextCommandsTitle}
      hint={imCopy.feishuTextCommandsHint}
      commands={imCopy.feishuTextCommands}
    />
  );
}

export function WeChatCommandReference({ imCopy }: { imCopy: ImCopy }) {
  return (
    <TextCommandReference
      title={imCopy.wechatTextCommandsTitle}
      hint={imCopy.wechatTextCommandsHint}
      commands={imCopy.wechatTextCommands}
    />
  );
}

function TextCommandReference({
  title,
  hint,
  commands,
}: {
  title: string;
  hint: string;
  commands: { command: string; description: string }[];
}) {
  return (
    <div className="min-w-0 rounded-sm bg-hover/35 px-2.5 py-2">
      <div className="space-y-1">
        <h4 className="text-[12px] font-semibold leading-[1.45] text-ink">
          {title}
        </h4>
        <p className="text-[12px] leading-[1.45] text-ink-muted">{hint}</p>
      </div>
      <ul className="mt-2 grid min-w-0 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {commands.map((item) => (
          <li
            key={item.command}
            className="grid min-w-0 gap-1 sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-baseline sm:gap-2"
          >
            <code className="w-fit max-w-full whitespace-nowrap rounded-sm border border-line/70 bg-surface px-1.5 py-[1px] font-mono text-[11.5px] leading-[1.5] text-ink">
              {item.command}
            </code>
            <span className="min-w-0 text-[12px] leading-[1.5] text-ink-muted">
              {item.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
