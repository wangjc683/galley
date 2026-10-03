import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusIcon } from "./status-icon";

const render = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("StatusIcon done check", () => {
  it("draws a settled idle row as the completed check circle", () => {
    expect(render(<StatusIcon status="idle" />)).toBe(
      render(<StatusIcon status="completed" />),
    );
    expect(render(<StatusIcon status="idle" unread />)).toBe(
      render(<StatusIcon status="completed" unread />),
    );
  });

  it("keeps the hollow ring for an idle row that did not finish", () => {
    expect(render(<StatusIcon status="idle" incomplete />)).not.toBe(
      render(<StatusIcon status="completed" />),
    );
  });

  it("is muted when read and brand only when unread", () => {
    expect(render(<StatusIcon status="completed" />)).toContain(
      "text-ink-muted",
    );
    expect(render(<StatusIcon status="completed" unread />)).toContain(
      "text-brand",
    );
  });
});
