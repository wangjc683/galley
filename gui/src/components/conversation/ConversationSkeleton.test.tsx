import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConversationSkeleton } from "./ConversationSkeleton";

describe("ConversationSkeleton", () => {
  it("ghosts the user's words as bubbles on the right, capped like the bubble", () => {
    const html = renderToStaticMarkup(<ConversationSkeleton />);
    const ghosts = [...html.matchAll(/class="([^"]*ml-auto[^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(ghosts).toHaveLength(2);
    for (const ghost of ghosts) {
      expect(ghost).toContain("rounded-md");
      expect(ghost).toContain("h-[45px]");
    }
    // 60% and 40% of the bubble's cap, min(80%, 560px).
    expect(ghosts[0]).toContain("w-[min(48%,336px)]");
    expect(ghosts[1]).toContain("w-[min(32%,224px)]");
    // The pre-bubble band with its left rule is gone.
    expect(html).not.toContain("border-l-4");
  });
});
