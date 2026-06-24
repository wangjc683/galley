export function ConnectionSteps({
  steps,
  status,
}: {
  steps: string[];
  status: string;
}) {
  return (
    <div className="max-w-[68ch] space-y-2">
      <ol className="space-y-1.5 text-[12.5px] leading-[1.5] text-ink-soft">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2.5">
            <span className="mt-[1px] inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-app font-mono text-[11px] font-medium tabular-nums text-ink-soft">
              {index + 1}
            </span>
            <span className="min-w-0 pt-px">{step}</span>
          </li>
        ))}
      </ol>
      <p className="pl-7 text-[12px] leading-[1.45] text-ink-muted">{status}</p>
    </div>
  );
}
