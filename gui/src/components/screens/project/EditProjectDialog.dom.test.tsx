// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { CopyProvider } from "@/lib/i18n";
import type { Project } from "@/types/session";

import { EditProjectDialog } from "./EditProjectDialog";

/**
 * A save Core refuses (2026-11-10 audit, A7): `updateProject` rejects
 * now, so the dialog's own catch runs — it stays open with what was
 * typed, and 保存 can be pressed again.
 */

const PROJECT: Project = {
  id: "proj_a",
  name: "甲",
  workspaceEnabled: false,
  pinned: false,
  lastActivityAt: "2026-11-10T00:00:00.000Z",
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
};

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

/** Type into the name field the way React hears it. */
function typeName(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const saveButton = () =>
  [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent === zhCopy.common.save,
  )!;

describe("saving a project Core refuses", () => {
  it("keeps the dialog open with the new name, 保存 enabled again", async () => {
    const onClose = vi.fn();
    const onSave = vi.fn(async () => {
      throw "database is locked";
    });
    act(() =>
      root.render(
        <CopyProvider language="zh-CN">
          <EditProjectDialog
            project={PROJECT}
            onClose={onClose}
            onSave={onSave}
            onRequestDelete={() => {}}
          />
        </CopyProvider>,
      ),
    );
    // The dialog fills its fields on the next tick.
    act(() => vi.runAllTimers());
    const input =
      document.body.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input.value).toBe("甲");
    typeName(input, "乙");
    expect(saveButton().disabled).toBe(false);

    await act(async () => {
      saveButton().click();
    });

    expect(onSave).toHaveBeenCalledWith("proj_a", {
      name: "乙",
      rootPath: undefined,
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(input.value).toBe("乙");
    expect(saveButton().disabled).toBe(false);
  });
});
