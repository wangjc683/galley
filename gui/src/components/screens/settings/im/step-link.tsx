import { ArrowSquareOut } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/** Replace a `{link}` placeholder in a step's copy with an inline
 * external link (anchor style per SettingsUpdateControl's precedent).
 * The label is a proper noun (portal / bot name), so it lives in code,
 * not the locales. */
export function stepWithLink(
  template: string,
  label: string,
  url: string,
): ReactNode {
  const [pre, post] = template.split("{link}");
  if (post === undefined) return template;
  return (
    <>
      {pre}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 text-brand-strong underline decoration-brand-strong/35 underline-offset-[3px] hover:decoration-brand-strong"
      >
        <span>{label}</span>
        <ArrowSquareOut size={10} weight="thin" />
      </a>
      {post}
    </>
  );
}
