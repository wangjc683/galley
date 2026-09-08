import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GitFileList } from "./GitFileList";

describe("Git changed-file list", () => {
  it("renders grouped rows with status chips and marks the selection", () => {
    const html = renderToStaticMarkup(
      <Tooltip.Provider>
        <GitFileList
          tracked={[
            { path: "src/a.ts", status: "modified" },
            { path: "old.md", status: "deleted" },
          ]}
          untracked={[{ path: "notes/new.md", status: "untracked" }]}
          selectedPath="old.md"
          onSelect={() => {}}
        />
      </Tooltip.Provider>,
    );
    expect(html).toContain('role="listbox"');
    expect(html).toContain("已跟踪文件的改动");
    expect(html).toContain("未跟踪文件");
    expect(html).toContain("修改");
    expect(html).toContain("删除");
    expect(html).toContain("src/a.ts");
    expect(html).toContain('data-git-file="old.md"');
    expect(html).toContain('aria-selected="true"');
    expect(html).not.toContain("<select");
  });
});
