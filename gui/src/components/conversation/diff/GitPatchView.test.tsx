import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GitPatchView } from "./GitPatchView";

const patch = `diff --git a/report.md b/report.md
index 3367afd..3e75765 100644
--- a/report.md
+++ b/report.md
@@ -1,2 +1,2 @@
 # Report
-before text
+after text
`;

function render(source: string, split = false) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <GitPatchView patch={source} split={split} />
    </Tooltip.Provider>,
  );
}

describe("Git patch presentation", () => {
  it("shows removed and added lines in both layouts, with navigation", () => {
    for (const split of [false, true]) {
      const html = render(patch, split);
      expect(html).toContain("diff-code-delete");
      expect(html).toContain("diff-code-insert");
      expect(html).toContain("before");
      expect(html).toContain("after");
      expect(html).toContain("上一处改动");
      expect(html).toContain("data-git-hunk");
      // Reader-facing hunk locator + change counter replace the raw @@ header.
      expect(html).toContain("第 1 行起");
      expect(html).toContain("共 1 处改动");
      expect(html).not.toContain("@@ -1,2 +1,2 @@</div>");
    }
  });
  it("keeps source HTML inert", () => {
    const html = render(
      patch.replace("after text", "<script>alert(1)</script>"),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;");
  });
  it("explains metadata-only patches and malformed input", () => {
    expect(
      render(
        "diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n",
      ),
    ).toContain("仅属性发生变化");
    expect(render("not a patch")).toContain("无法显示此差异");
  });
});
