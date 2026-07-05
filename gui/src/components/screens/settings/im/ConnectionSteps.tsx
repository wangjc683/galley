export function ConnectionSteps({
  steps,
  status,
}: {
  steps: string[];
  status: string;
}) {
  return (
    <div className="max-w-[68ch] space-y-2">
      <ol className="space-y-1.5 text-ui-secondary leading-notice text-ink-soft">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2.5">
            <span className="mt-[1px] inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-app font-mono text-ui-label font-medium tabular-nums text-ink-soft">
              {index + 1}
            </span>
            <span className="min-w-0 pt-px">{step}</span>
          </li>
        ))}
      </ol>
      <p className="pl-7 text-ui-meta leading-dense text-ink-muted">{status}</p>
    </div>
  );
}
