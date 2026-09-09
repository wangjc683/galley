import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseDelimited, prettyJson } from "@/lib/text-preview";
import { TextPreview } from "./TextPreview";

function render(path: string, content: string) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <TextPreview path={path} content={content} />
    </Tooltip.Provider>,
  );
}

describe("delimited parsing", () => {
  it("handles quoted delimiters, doubled quotes, embedded newlines and CRLF", () => {
    const table = parseDelimited(
      'name,note\r\n"Smith, J","said ""hi""\nthen left"\r\nLee,ok\r\n',
      ",",
    );
    expect(table).toEqual({
      header: ["name", "note"],
      rows: [
        ["Smith, J", 'said "hi"\nthen left'],
        ["Lee", "ok"],
      ],
    });
  });
  it("refuses to draw a grid for irregular or single-column content", () => {
    expect(parseDelimited("a,b\n1,2,3\n", ",")).toBeNull();
    expect(parseDelimited("just one column\nno delimiter\n", ",")).toBeNull();
    expect(parseDelimited('a,b\n"unterminated,1\n', ",")).toBeNull();
    // A trailing delimiter on data rows is tolerated (common exporter quirk).
    expect(parseDelimited("a,b\n1,2,\n", ",")?.rows).toEqual([["1", "2"]]);
  });
});

describe("JSON pretty printing", () => {
  it("re-indents single-line JSON and leaves formatted or invalid content alone", () => {
    expect(prettyJson('{"a":[1,2],"b":{"c":true}}')).toBe(
      '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": true\n  }\n}',
    );
    expect(prettyJson('{\n  "a": 1\n}')).toBeNull();
    expect(prettyJson("{not json")).toBeNull();
  });
});

describe("text preview rendering", () => {
  it("renders a CSV as a table with a shape caption and numbered rows", () => {
    const html = render("/tmp/data.csv", "city,count\nBeijing,3\nShanghai,5\n");
    expect(html).toContain("<table");
    expect(html).toContain("2 行 × 2 列");
    expect(html).toContain("Shanghai");
    expect(html).not.toContain("git-review-plain");
  });
  it("falls back to numbered plain lines with the line count for code and irregular data", () => {
    const code = render("/tmp/tool.py", "import os\nprint(os.getcwd())\n");
    expect(code).toContain("git-review-plain");
    expect(code).toContain("3 行");
    expect(code).toContain("print(os.getcwd())");
    const ragged = render("/tmp/data.csv", "a,b\n1,2,3\n");
    expect(ragged).toContain("git-review-plain");
    expect(ragged).toContain("以纯文本显示");
  });
  it("notes when JSON was reformatted for reading", () => {
    const html = render("/tmp/out.json", '{"ok":true}');
    expect(html).toContain("已格式化显示");
    expect(html).toContain("&quot;ok&quot;: true");
  });
});
