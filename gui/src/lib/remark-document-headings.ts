interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hProperties?: Record<string, unknown> };
}

/** Document-only IDs for table-of-contents anchors; no duplicate IDs in chat. */
export function remarkDocumentHeadings() {
  return (tree: Node) => {
    const used = new Set<string>();
    const text = (node: Node): string =>
      node.value ?? node.children?.map(text).join("") ?? "";
    const visit = (node: Node) => {
      if (node.type === "heading") {
        const base = text(node)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
          .replace(/\s/g, "-");
        let id = base;
        for (let suffix = 1; used.has(id); suffix += 1)
          id = `${base}-${suffix}`;
        used.add(id);
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, id },
        };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
