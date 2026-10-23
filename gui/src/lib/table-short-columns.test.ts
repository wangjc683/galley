import { describe, expect, it } from "vitest";

import {
  SHORT_COLUMN_MAX,
  SHORT_COLUMNS_BUDGET,
  shortTableColumns,
} from "./table-short-columns";

/** Columns a table keeps on one line (ruling 136, ticket 92); how the
 * cells' text is read off the Markdown is MarkdownView.test.tsx's. */

const LONG = "这是一格很长的判断，远远超过八个汉字。";

const short = (rows: string[][]) => [...shortTableColumns(rows)];

describe("shortTableColumns", () => {
  it("is short up to 16 columns, not at 17", () => {
    expect(SHORT_COLUMN_MAX).toBe(16);
    expect(
      short([
        ["a".repeat(16), "a".repeat(17), LONG],
        ["一二三四五六七八", "一二三四五六七八x", LONG],
      ]),
    ).toEqual([0]);
  });

  it("counts a half-width character 1 and a full-width one 2", () => {
    expect(short([["abcdefghijklmnop", LONG]])).toEqual([0]);
    expect(short([["abcdefghijklmnopq", LONG]])).toEqual([]);
    // 7 CJK + a full-width comma is 16; 8 CJK + one is 18.
    expect(short([["一二三四五六七，", LONG]])).toEqual([0]);
    expect(short([["一二三四五六七八，", LONG]])).toEqual([]);
    // CJK punctuation and fullwidth digits count 2 too.
    expect(short([["「一二三四五六」", LONG]])).toEqual([0]);
    expect(short([["１２３４５６７８９", LONG]])).toEqual([]);
  });

  it("measures the header too: a long header makes the column long", () => {
    expect(
      short([
        ["常规赛排名第几名第几", "球队", "判断"],
        ["1", "尼克斯", LONG],
      ]),
    ).toEqual([1]);
  });

  it("keeps the short columns whole up to 40 columns between them, none at 41", () => {
    expect(SHORT_COLUMNS_BUDGET).toBe(40);
    const a = (n: number) => "a".repeat(n);
    expect(short([[a(16), a(16), a(8), LONG]])).toEqual([0, 1, 2]);
    expect(short([[a(16), a(16), a(9), LONG]])).toEqual([]);
    // The total is of each column's widest cell, not of a row: the rows
    // come to 26 and 33, the columns to 48.
    expect(
      short([
        [a(16), a(9), a(1), LONG],
        [a(1), a(16), a(16), LONG],
      ]),
    ).toEqual([]);
  });

  it("goes by position when rows are ragged; a missing cell does not count", () => {
    expect(
      short([
        ["序号", "名称", "备注"],
        ["1"],
        ["2", LONG],
        ["3", "苹果", "无", "多一格"],
      ]),
    ).toEqual([0, 2, 3]);
  });

  it("keeps a table of only short columns whole", () => {
    expect(
      short([
        ["序号", "水果", "价格"],
        ["1", "苹果", "5 元"],
        ["2", "香蕉", "3 元"],
      ]),
    ).toEqual([0, 1, 2]);
  });

  it("keeps nothing whole without a short column", () => {
    expect(short([[LONG, LONG]])).toEqual([]);
    expect(short([])).toEqual([]);
  });
});
