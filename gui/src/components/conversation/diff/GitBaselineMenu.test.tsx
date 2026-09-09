import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatCommitDate } from "@/lib/git-review";
import { GitBaselineMenu } from "./GitBaselineMenu";

const commits = [
  {
    id: "0123456789abcdef0123456789abcdef01234567",
    subject: "Add reading panel",
    author: "JC",
    authoredAt: "2026-09-09T10:00:00+08:00",
  },
];

function render(base: string | null) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <GitBaselineMenu
        commits={commits}
        base={base}
        loading={false}
        onOpen={() => {}}
        onSelect={() => {}}
      />
    </Tooltip.Provider>,
  );
}

describe("Git baseline picker", () => {
  it("labels the trigger with the latest commit by default and the chosen commit otherwise", () => {
    expect(render(null)).toContain("最近一次提交");
    const chosen = render(commits[0].id);
    expect(chosen).toContain("01234567");
    expect(chosen).toContain("Add reading panel");
    expect(chosen).toContain("选择比较基线");
  });
  it("formats commit dates and passes unparseable input through", () => {
    expect(formatCommitDate("not a date")).toBe("not a date");
    expect(formatCommitDate("2026-09-09T10:00:00+08:00")).not.toBe("");
  });
});
