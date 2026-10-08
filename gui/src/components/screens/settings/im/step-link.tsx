import type { ReactNode } from "react";

import { ExternalTextLink } from "../external-link";
import { InlineCodeText } from "../inline-code-text";

/** Replace a `{link}` placeholder in a step's copy with an inline
 * external link (the shared `ExternalTextLink`, brand tone).
 * The label is a proper noun (portal / bot name), so it lives in code,
 * not the locales. Backtick pairs in the rest of the copy become inline
 * code chips, as in `ConnectionSteps`. */
export function stepWithLink(
  template: string,
  label: string,
  url: string,
): ReactNode {
  const [pre, post] = template.split("{link}");
  if (post === undefined) return <InlineCodeText text={template} />;
  return (
    <>
      <InlineCodeText text={pre} />
      <ExternalTextLink href={url}>{label}</ExternalTextLink>
      <InlineCodeText text={post} />
    </>
  );
}
