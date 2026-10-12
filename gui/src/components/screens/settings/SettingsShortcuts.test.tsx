import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CopyProvider } from "@/lib/i18n";

import { SettingsShortcuts } from "./SettingsShortcuts";

describe("Settings → Shortcuts", () => {
  it("lists the sidebar toggle under 导航, with the external-GA note", () => {
    const html = renderToStaticMarkup(<SettingsShortcuts />);
    const row = html.indexOf("收起 / 展开侧栏");
    expect(row).toBeGreaterThan(html.indexOf(">新对话<"));
    expect(row).toBeLessThan(html.indexOf(">打开设置<"));
    expect(html).toContain("使用外部 GA 时不生效");
    // The key itself: ⌘ \ on macOS, Ctrl \ elsewhere.
    expect(html.slice(html.lastIndexOf("<li", row), row)).toContain(">\\<");
  });

  it("names it in English too", () => {
    const html = renderToStaticMarkup(
      <CopyProvider language="en-US">
        <SettingsShortcuts />
      </CopyProvider>,
    );
    expect(html).toContain("Hide / show sidebar");
    expect(html).toContain("Not available with an external GA.");
  });
});
