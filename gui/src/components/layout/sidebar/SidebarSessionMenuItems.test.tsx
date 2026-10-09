import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Project, Session } from "@/types/session";

import { SidebarSessionMenuItems } from "./SidebarSessionMenuItems";

// useCopy falls back to the zh copy without a CopyProvider.

// A closed Radix menu renders nothing statically, and its content is
// portalled; stand the primitives in as plain markup so the submenu's
// rows can be read in order.
vi.mock("./SidebarRowMenu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    SidebarRowMenuPortal: Pass,
    SidebarRowMenuSub: Pass,
    SidebarRowMenuSubContent: Pass,
    SidebarRowMenuSubTrigger: ({ children }: { children?: ReactNode }) => (
      <div data-row="trigger">{children}</div>
    ),
    SidebarRowMenuItem: ({ children }: { children?: ReactNode }) => (
      <div data-row="item">{children}</div>
    ),
    SidebarRowMenuSeparator: () => <div data-row="separator" />,
  };
});

const project = (id: string, name: string) =>
  ({
    id,
    name,
    workspaceEnabled: false,
    pinned: false,
    lastActivityAt: "2026-10-01T00:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  }) as Project;

const session = (projectId?: string) =>
  ({
    id: "s",
    title: "title-s",
    status: "idle",
    errorCount: 0,
    projectId,
    lastActivityAt: "2026-10-07T12:00:00.000Z",
    createdAt: "2026-10-07T12:00:00.000Z",
    updatedAt: "2026-10-07T12:00:00.000Z",
  }) as Session;

/** The menu as a list of rows: `trigger:…`, `item:…`, `separator`, and
 * `hint:…` for the plain 「还没有项目」 line. */
function rows(opts: {
  projects: Project[];
  projectId?: string;
  onCreate?: () => void;
}) {
  const html = renderToStaticMarkup(
    <SidebarSessionMenuItems
      kind="dropdown"
      session={session(opts.projectId)}
      projects={opts.projects}
      onAssignToProject={() => {}}
      onCreateProjectForSession={opts.onCreate}
    />,
  );
  const text = (inner: string) => inner.replace(/<[^>]+>/g, "");
  return [
    ...html.matchAll(
      /<div data-row="(trigger|item)">(.*?)<\/div>|<div data-row="separator"><\/div>|<div class="px-2\.5[^"]*">(.*?)<\/div>/g,
    ),
  ].map(([match, kind, inner, hint]) => {
    if (kind) return `${kind}:${text(inner)}`;
    if (hint !== undefined) return `hint:${text(hint)}`;
    expect(match).toContain("separator");
    return "separator";
  });
}

const projects = [project("a", "回归"), project("b", "发版")];

describe("SidebarSessionMenuItems project submenu", () => {
  it("offers 新建项目… alone when there is no project yet", () => {
    expect(rows({ projects: [], onCreate: () => {} })).toEqual([
      "trigger:加入项目",
      "item:新建项目…",
    ]);
  });

  it("keeps 还没有项目 when the host doesn't wire project creation", () => {
    expect(rows({ projects: [] })).toEqual([
      "trigger:加入项目",
      "hint:还没有项目",
    ]);
  });

  it("closes the project list with one separator before 新建项目…", () => {
    expect(rows({ projects, onCreate: () => {} })).toEqual([
      "trigger:加入项目",
      "item:回归",
      "item:发版",
      "separator",
      "item:新建项目…",
    ]);
  });

  it("reads 移到项目 for a session in a project, removal after 新建项目…", () => {
    expect(rows({ projects, projectId: "a", onCreate: () => {} })).toEqual([
      "trigger:移到项目",
      "item:回归",
      "item:发版",
      "separator",
      "item:新建项目…",
      "item:从项目移除",
    ]);
  });

  it("leaves the unwired submenu as it was", () => {
    expect(rows({ projects, projectId: "a" })).toEqual([
      "trigger:移到项目",
      "item:回归",
      "item:发版",
      "separator",
      "item:从项目移除",
    ]);
    expect(rows({ projects })).toEqual([
      "trigger:加入项目",
      "item:回归",
      "item:发版",
    ]);
  });
});
