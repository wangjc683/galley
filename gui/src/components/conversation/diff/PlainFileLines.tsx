/**
 * Untracked file content in the same gutter-plus-code register as the
 * Git patch table, without claiming it is a diff: numbered lines, no
 * insert tint. Core already bounds the content (2 MiB / 5000 lines).
 */
export function PlainFileLines({ content }: { content: string }) {
  const lines = content.split("\n");
  const width = String(lines.length).length;
  return (
    <div className="git-review-plain font-mono text-[12px] leading-[1.5] text-ink">
      {lines.map((line, index) => (
        <div key={index} className="flex">
          <span
            aria-hidden="true"
            className="shrink-0 select-none pr-[1ch] text-right tabular-nums text-ink-muted"
            style={{ width: `${width + 2}ch` }}
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere] pl-[0.5em]">
            {line}
          </span>
        </div>
      ))}
    </div>
  );
}
