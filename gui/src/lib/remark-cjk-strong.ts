// CommonMark deliberately keeps `名叫**"下一个字"**` literal: the
// opener follows a CJK letter and precedes punctuation. LLMs emit this
// shape often enough that Galley should render the intended emphasis
// without asking the user to mentally parse raw `**` markers.

type MarkdownAstNode = {
  type: string;
  value?: string;
  children?: MarkdownAstNode[];
  [key: string]: unknown;
};

const CJK_ADJACENT_QUOTED_STRONG =
  /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])\*\*((?:["'“‘「『《（(])[^*\n]+?(?:["'”’」』》）)]))\*\*/gu;

export function remarkCjkAdjacentQuotedStrong() {
  return (tree: MarkdownAstNode) => {
    transformCjkAdjacentQuotedStrong(tree);
  };
}

function transformCjkAdjacentQuotedStrong(node: MarkdownAstNode) {
  if (!node.children) return;

  const nextChildren: MarkdownAstNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      nextChildren.push(
        ...(splitCjkAdjacentQuotedStrong(child.value) ?? [child]),
      );
      continue;
    }

    transformCjkAdjacentQuotedStrong(child);
    nextChildren.push(child);
  }

  node.children = nextChildren;
}

function splitCjkAdjacentQuotedStrong(value: string): MarkdownAstNode[] | null {
  const pieces: MarkdownAstNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(CJK_ADJACENT_QUOTED_STRONG)) {
    const start = match.index ?? 0;
    const [fullMatch, prefixChar, strongText] = match;

    if (start > lastIndex) {
      pieces.push({ type: "text", value: value.slice(lastIndex, start) });
    }
    pieces.push({ type: "text", value: prefixChar });
    pieces.push({
      type: "strong",
      children: [{ type: "text", value: strongText }],
    });
    lastIndex = start + fullMatch.length;
  }

  if (pieces.length === 0) return null;
  if (lastIndex < value.length) {
    pieces.push({ type: "text", value: value.slice(lastIndex) });
  }
  return pieces;
}
