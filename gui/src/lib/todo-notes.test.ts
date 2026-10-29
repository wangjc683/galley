import { describe, expect, it } from "vitest";

import {
  todoNotesDay,
  todoNotesFolded,
  todoNotesParagraphs,
  type TodoNotesPiece,
} from "./todo-notes";

/**
 * A to-do's notes as the panel draws them (main chat ticket 112, PRD
 * ruling 158 point 3): a paragraph a line, the leading day set apart, a
 * full path in backticks the file by its name; and the folded row's one
 * line.
 */

/** A paragraph's pieces in short: `[day]`, words, `<name|path>`. */
function gist(pieces: readonly TodoNotesPiece[]): string {
  return pieces
    .map((piece) =>
      piece.kind === "day"
        ? `[${piece.text}]`
        : piece.kind === "path"
          ? `<${piece.name}|${piece.path}>`
          : piece.text,
    )
    .join("");
}

describe("paragraphs", () => {
  it("makes each line a paragraph, a run of blank lines one gap", () => {
    const notes = "第一行\n第二行\n\n\n  \n第三行";
    const paragraphs = todoNotesParagraphs(notes);
    expect(paragraphs.map((p) => gist(p.pieces))).toEqual([
      "第一行",
      "第二行",
      "第三行",
    ]);
    // Each knows where it starts in the notes.
    expect(paragraphs.map((p) => notes.slice(p.start, p.start + 3))).toEqual([
      "第一行",
      "第二行",
      "第三行",
    ]);
    expect(todoNotesParagraphs("")).toEqual([]);
    expect(todoNotesParagraphs("\n \n")).toEqual([]);
  });

  it("keeps a line's own spaces, and leaves a Windows break's \\r out", () => {
    expect(
      todoNotesParagraphs("A 座  3 楼\r\n带身份证").map((p) => gist(p.pieces)),
    ).toEqual(["A 座  3 楼", "带身份证"]);
  });
});

describe("the day a paragraph starts with", () => {
  it("knows 「10月29日：」 and `Oct 29:`, the colon with it", () => {
    for (const [line, day] of [
      ["10月29日：业主说筹开预算下周给", "10月29日："],
      ["10月29日:业主说", "10月29日:"],
      ["1月3日：好了", "1月3日："],
      ["10 月 29 日：有空格", "10 月 29 日："],
      ["Oct 29: the owner sends the budget next week", "Oct 29:"],
      ["Sept 3: done", "Sept 3:"],
      ["Oct. 29: done", "Oct. 29:"],
    ]) {
      expect(line.slice(0, todoNotesDay(line)), line).toBe(day);
    }
  });

  it("knows nothing else: no colon, not at the start, a year first, a month in full, a slash", () => {
    for (const line of [
      "10月29日业主说",
      "业主说 10月29日：给",
      " 10月29日：前面有空格",
      "2026年10月29日：带年份",
      "October 29: in full",
      "10/29：斜杠",
      "收集要点：品牌、预算",
      "Oct29: no space",
    ]) {
      expect(todoNotesDay(line), line).toBe(0);
    }
  });

  it("sets the day apart as the first piece, the rest as words", () => {
    const [p] = todoNotesParagraphs("10月29日：公开资料整理好了");
    expect(gist(p.pieces)).toBe("[10月29日：]公开资料整理好了");
    expect(p.pieces[1]).toMatchObject({ kind: "text", start: 7 });
  });
});

describe("a full path in backticks", () => {
  it("is the file, by its name, the backticks gone", () => {
    const notes =
      "10月28日：资料收集模板做好了：`/Users/jc/Downloads/希尔顿项目资料收集模板.md`，等业主发来";
    const [p] = todoNotesParagraphs(notes);
    expect(gist(p.pieces)).toBe(
      "[10月28日：]资料收集模板做好了：<希尔顿项目资料收集模板.md|/Users/jc/Downloads/希尔顿项目资料收集模板.md>，等业主发来",
    );
    const file = p.pieces.find((piece) => piece.kind === "path")!;
    // Where its backticks are in the notes.
    expect(file.kind === "path" && notes.slice(file.start, file.end)).toBe(
      "`/Users/jc/Downloads/希尔顿项目资料收集模板.md`",
    );
  });

  it("takes the reply's paths: ~/, file://, a Windows drive, UNC; one space off each end", () => {
    for (const [inner, name] of [
      ["~/Downloads/搬家报价/对比.md", "对比.md"],
      ["file:///Users/jc/a%20b.pdf", "a b.pdf"],
      ["C:\\Users\\jc\\报价.xlsx", "报价.xlsx"],
      ["\\\\server\\share\\plan.docx", "plan.docx"],
      [" /tmp/x.txt ", "x.txt"],
    ]) {
      const [p] = todoNotesParagraphs(`看 \`${inner}\``);
      expect(gist(p.pieces), inner).toBe(
        `看 <${name}|${p.pieces[1].kind === "path" ? p.pieces[1].path : "?"}>`,
      );
    }
  });

  it("leaves backticks round anything else, and a bare path, as words", () => {
    for (const line of [
      "用 `todo show` 看",
      "相对路径 `Downloads/a.md` 不算",
      "没有反引号 /Users/jc/a.md 也不算",
      "只有一个 ` 反引号 /a.md",
      "空的 `` 两个",
    ]) {
      expect(gist(todoNotesParagraphs(line)[0].pieces), line).toBe(line);
    }
  });

  it("can be several in a line, and next to the day", () => {
    const [p] = todoNotesParagraphs("Oct 29: `/a/one.md` and `/b/two.md`");
    expect(gist(p.pieces)).toBe(
      "[Oct 29:] <one.md|/a/one.md> and <two.md|/b/two.md>",
    );
  });
});

describe("the folded line", () => {
  it("says a backticked path by its name, every break and run of space one space", () => {
    expect(
      todoNotesFolded(
        "10月29日：模板做好了：`/Users/jc/Downloads/模板.md`\n\n收集要点：  品牌、预算",
      ),
    ).toBe("10月29日：模板做好了：模板.md 收集要点： 品牌、预算");
  });

  it("leaves other backticks and bare paths as written", () => {
    expect(todoNotesFolded("用 `todo show`，/Users/jc/a.md")).toBe(
      "用 `todo show`，/Users/jc/a.md",
    );
  });
});
