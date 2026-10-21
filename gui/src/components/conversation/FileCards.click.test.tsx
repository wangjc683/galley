// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import { LocalFilesContext } from "@/lib/local-files";

import { FileCards } from "./FileCards";
import { LocalFileReference } from "./LocalFileReference";

/**
 * Where a click goes (main chat ticket 74, after JC's 2026-10-21 call):
 * a file card opens a document in its default application — HTML
 * included, a delivered page is seen rendered — and sends Markdown,
 * text and the rest where a file reference goes; an image opens the
 * image viewer. A file reference in the text opens a document the
 * reading panel cannot show (pdf) in its default application, and
 * keeps HTML in the reading panel as source.
 */

const calls = vi.hoisted(() => ({
  operations: [] as [string, string][],
}));
vi.mock("@/lib/local-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/local-files")>()),
  // Core's inspect: there, its kind by name.
  accessLocalFile: async (path: string) => ({
    path,
    kind: /\.(png|jpe?g)$/.test(path)
      ? "image"
      : /\.md$/.test(path)
        ? "markdown"
        : /\.(txt|html)$/.test(path)
          ? "text"
          : "file",
    content: null,
  }),
  fileOperation: async (path: string, action: string) => {
    calls.operations.push([path, action]);
  },
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
const activated: string[] = [];
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  calls.operations = [];
  activated.length = 0;
});

function mount(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>
          <LocalFilesContext.Provider value={(path) => activated.push(path)}>
            {node}
          </LocalFilesContext.Provider>
        </Tooltip.Provider>
      </CopyProvider>,
    );
  });
  return container;
}

/** Click, then let the card's re-check come back. */
async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("nothing to click");
  await act(async () => {
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("a click on a file card", () => {
  const PATHS = [
    "/Users/jc/out/report.pdf",
    "/Users/jc/out/plan.html",
    "/Users/jc/out/notes.md",
    "/Users/jc/out/banner.png",
    "/Users/jc/out/bundle.zip",
  ];
  const card = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll('[data-role="file-card"]')].find((el) =>
      (el.textContent ?? el.getAttribute("aria-label") ?? "").includes(name),
    );
  const mainButton = (el: Element | undefined) =>
    el?.matches("button") ? el : el?.querySelector("button");

  it("opens pdf and HTML in the default application", async () => {
    const container = mount(<FileCards paths={PATHS} />);
    await click(mainButton(card(container, "report.pdf")));
    await click(mainButton(card(container, "plan.html")));
    expect(calls.operations).toEqual([
      ["/Users/jc/out/report.pdf", "open"],
      ["/Users/jc/out/plan.html", "open"],
    ]);
    expect(activated).toEqual([]);
  });

  it("sends Markdown to the reading panel and a zip where a reference goes (its folder)", async () => {
    const container = mount(<FileCards paths={PATHS} />);
    await click(mainButton(card(container, "notes.md")));
    await click(mainButton(card(container, "bundle.zip")));
    expect(activated).toEqual([
      "/Users/jc/out/notes.md",
      "/Users/jc/out/bundle.zip",
    ]);
    expect(calls.operations).toEqual([]);
  });

  it("opens an image in the conversation's image viewer", async () => {
    const container = mount(<FileCards paths={PATHS} />);
    const thumbnail = container.querySelector('[data-file-kind="image"]');
    expect(thumbnail?.getAttribute("aria-label")).toBe("预览图片 · banner.png");
    await click(thumbnail);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(calls.operations).toEqual([]);
    expect(activated).toEqual([]);
  });
});

describe("a click on a file reference in the text", () => {
  const reference = (path: string) => {
    const container = mount(
      <LocalFileReference path={path}>
        <code>{path}</code>
      </LocalFileReference>,
    );
    return container.querySelector("button");
  };

  it("opens a pdf in the default application", async () => {
    await click(reference("/tmp/out/report.pdf"));
    expect(calls.operations).toEqual([["/tmp/out/report.pdf", "open"]]);
    expect(activated).toEqual([]);
  });

  it("keeps HTML in the reading panel, as source", async () => {
    await click(reference("/tmp/out/page.html"));
    expect(activated).toEqual(["/tmp/out/page.html"]);
    expect(calls.operations).toEqual([]);
  });

  it("leaves a zip to the reading panel's judgment (its folder)", async () => {
    await click(reference("/tmp/out/bundle.zip"));
    expect(activated).toEqual(["/tmp/out/bundle.zip"]);
    expect(calls.operations).toEqual([]);
  });
});
