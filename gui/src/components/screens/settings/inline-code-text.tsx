import { Fragment } from "react";

import { INLINE_CODE_CLASS } from "./inline-code";

/**
 * Renders a copy string whose command names are wrapped in backticks
 * (copy-language-guidelines: `galley` is shown as inline code). Each
 * backtick pair becomes a `<code>` chip; everything else passes through
 * as text. An unpaired or empty pair stays literal, so a stray backtick
 * in copy never swallows the rest of the sentence.
 */
export function InlineCodeText({ text }: { text: string }) {
  const segments = text.split("`");
  // An even segment count means an odd number of backticks: the last
  // opening one has no partner.
  const lastIsUnclosed = segments.length % 2 === 0;
  return (
    <>
      {segments.map((segment, index) => {
        const isCode = index % 2 === 1;
        if (!isCode) {
          return segment ? <Fragment key={index}>{segment}</Fragment> : null;
        }
        if (lastIsUnclosed && index === segments.length - 1) {
          return <Fragment key={index}>{`\`${segment}`}</Fragment>;
        }
        if (segment === "") {
          return <Fragment key={index}>{"``"}</Fragment>;
        }
        return (
          <code key={index} className={INLINE_CODE_CLASS}>
            {segment}
          </code>
        );
      })}
    </>
  );
}
