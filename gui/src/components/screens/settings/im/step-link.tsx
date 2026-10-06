import type { ReactNode } from "react";

import { ExternalTextLink } from "../external-link";

/** Replace a `{link}` placeholder in a step's copy with an inline
 * external link (the shared `ExternalTextLink`, brand tone).
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
      <ExternalTextLink href={url}>{label}</ExternalTextLink>
      {post}
    </>
  );
}
