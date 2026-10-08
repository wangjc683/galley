import type { ReactNode } from "react";

import { InlineCodeText } from "../inline-code-text";

/**
 * Numbered setup steps. A plain-string step renders its backtick pairs
 * as inline code chips (`/newbot`, `MESSAGE CONTENT INTENT`), the same
 * way `stepWithLink` handles its `{link}` placeholder. The optional
 * status line sits under the list, indented to the step text.
 */
export function ConnectionSteps({
  steps,
  status,
}: {
  steps: ReactNode[];
  status?: string | null;
}) {
  return (
    <div className="max-w-[68ch] space-y-2">
      <ol className="space-y-1.5 text-ui-secondary leading-notice text-ink-soft">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-2.5">
            <span className="mt-[1px] inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-app font-mono text-ui-label font-medium tabular-nums text-ink-soft">
              {index + 1}
            </span>
            <span className="min-w-0 pt-px">
              {typeof step === "string" ? <InlineCodeText text={step} /> : step}
            </span>
          </li>
        ))}
      </ol>
      {status ? (
        <p className="pl-7 text-ui-meta leading-dense text-ink-muted">
          {status}
        </p>
      ) : null}
    </div>
  );
}
