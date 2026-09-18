import { createContext } from "react";

/**
 * Render-site context for CodeBlock (kept out of the component file so
 * fast refresh sees only components there). MarkdownView provides it;
 * the in-flight streaming partial turns folding off — folding what is
 * still being written would hide the newest lines.
 */
export const CodeBlockContext = createContext<{ collapsible: boolean }>({
  collapsible: true,
});
